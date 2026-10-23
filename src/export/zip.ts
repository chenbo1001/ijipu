/**
 * export/zip.ts — 最小 ZIP 读写（**store 不压缩**，零第三方依赖）
 *
 * 由来：adj1075 的卡片模板 zip 里已经有一份实现；adj1085 的"导出/导入本机配置"
 * 也要打 zip（设置 JSON + 卡片背景图），于是把通用部分抽到这里，两处共用一份。
 *
 * 约束（与原来一致）：
 *  - 只写 **store（method 0）** 条目：内容本身是 JSON / PNG/JPG，压缩收益不值得引依赖；
 *  - 文件名 UTF-8（flag 0x0800），CRC32 复用引擎 `crc32`；
 *  - 读中央目录 + 本地头；遇到 deflate 条目给出明确错误，不静默失败。
 */
import { crc32 } from '@ijipu/engine'

const ENC = new TextEncoder()
const DEC = new TextDecoder()

export interface ZipEntry {
  /** zip 内的相对路径（用 `/` 分隔） */
  name: string
  data: Uint8Array
}

/** 二进制 → base64（分块，避免 `String.fromCharCode(...大数组)` 爆栈） */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

/** base64 → 二进制 */
export function base64ToBytes(base64: string): Uint8Array {
  const s = atob(base64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i)
  return out
}

/** DOS 时间（zip 头用）；固定当前时间即可，不参与内容判等 */
function dosDateTime(d = new Date()): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** 打包（store 条目） */
export function writeZip(files: ZipEntry[]): Uint8Array {
  const { time, date } = dosDateTime()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = ENC.encode(file.name)
    const crc = crc32(file.data)
    const local = new Uint8Array(30 + name.length)
    const ldv = new DataView(local.buffer)
    ldv.setUint32(0, 0x04034b50, true)
    ldv.setUint16(4, 20, true)
    ldv.setUint16(6, 0x0800, true)
    ldv.setUint16(8, 0, true)
    ldv.setUint16(10, time, true)
    ldv.setUint16(12, date, true)
    ldv.setUint32(14, crc, true)
    ldv.setUint32(18, file.data.length, true)
    ldv.setUint32(22, file.data.length, true)
    ldv.setUint16(26, name.length, true)
    ldv.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, file.data)

    const central = new Uint8Array(46 + name.length)
    const cdv = new DataView(central.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0x0800, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, time, true)
    cdv.setUint16(14, date, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, file.data.length, true)
    cdv.setUint32(24, file.data.length, true)
    cdv.setUint16(28, name.length, true)
    cdv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length + file.data.length
  }

  const centralSize = centrals.reduce((n, p) => n + p.length, 0)
  const eocd = new Uint8Array(22)
  const edv = new DataView(eocd.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, files.length, true)
  edv.setUint16(10, files.length, true)
  edv.setUint32(12, centralSize, true)
  edv.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + eocd.length)
  let p = 0
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/** 解包（只接受 store 条目；deflate 明确报错，让用户用本应用重新导出） */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件')

  const count = dv.getUint16(eocd + 10, true)
  const cdOffset = dv.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  let p = cdOffset

  for (let n = 0; n < count; n += 1) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    const method = dv.getUint16(p + 10, true)
    const compressed = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = DEC.decode(bytes.subarray(p + 46, p + 46 + nameLen))

    const localNameLen = dv.getUint16(localOffset + 26, true)
    const localExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (method !== 0) {
      throw new Error(`zip 条目 ${name} 用了压缩（${method}），请用本应用重新导出`)
    }
    out.set(name, bytes.slice(dataStart, dataStart + compressed))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}
