/**
 * b64.rs — 本机配置附件的 base64 编解码（adj1085）
 *
 * 为什么不复用 `cli_embed` 里那份：那是内嵌 CLI 的私有实现；这里给"配置附件读写"用，
 * 单独一个最小模块，避免为了一个函数把 CLI 的可见性放开（也让单元测试好写）。
 */
pub fn encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len() / 3 * 4 + 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied();
        let b2 = chunk.get(2).copied();
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 3) << 4) | ((b1.unwrap_or(0)) >> 4)) as usize] as char);
        out.push(match b1 {
            Some(v) => T[(((v & 15) << 2) | ((b2.unwrap_or(0)) >> 6)) as usize] as char,
            None => '=',
        });
        out.push(match b2 {
            Some(v) => T[(v & 63) as usize] as char,
            None => '=',
        });
    }
    out
}

pub fn decode(s: &str) -> Option<Vec<u8>> {
    let bytes = s.as_bytes();
    if bytes.len() % 4 != 0 {
        return None;
    }
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    };
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().filter(|c| **c == b'=').count();
        if pad > 2 {
            return None;
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            let v = if c == b'=' { 0 } else { val(c)? };
            n |= v << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_rejects_garbage() {
        for raw in [b"".as_slice(), b"a".as_slice(), b"ab".as_slice(), b"abc".as_slice(), &[0u8, 255, 7, 9]] {
            assert_eq!(decode(&encode(raw)).as_deref(), Some(raw));
        }
        assert!(decode("不是base64").is_none());
        assert!(decode("abc").is_none());
    }
}
