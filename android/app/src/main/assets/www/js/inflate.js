/* inflate.js — 纯 JS raw-DEFLATE 解压（puff 算法移植）
 * 用途：旧 Android WebView 的 DecompressionStream 不支持 'deflate-raw'（Chrome 103 才有），
 *       此时用本实现兜底解压 xlsx（zip）里的 deflate 流。
 * API:  PuffInflate(u8) -> Uint8Array
 */
var PuffInflate = (function () {
  'use strict';

  var MAXBITS = 15, MAXLCODES = 286, MAXDCODES = 30, FIXLCODES = 288;

  var LENS = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DISTS = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function State(data) {
    this.data = data;
    this.pos = 0;
    this.bitbuf = 0;
    this.bitcnt = 0;
    this.out = new Uint8Array(Math.max(4096, data.length * 4));
    this.outlen = 0;
  }
  State.prototype.ensure = function (n) {
    if (this.outlen + n <= this.out.length) return;
    var cap = this.out.length;
    while (cap < this.outlen + n) cap *= 2;
    var nb = new Uint8Array(cap);
    nb.set(this.out.subarray(0, this.outlen));
    this.out = nb;
  };
  State.prototype.put = function (b) {
    this.ensure(1);
    this.out[this.outlen++] = b & 0xff;
  };
  State.prototype.bits = function (need) {
    var val = this.bitbuf;
    while (this.bitcnt < need) {
      if (this.pos >= this.data.length) return -1;
      val |= this.data[this.pos++] << this.bitcnt;
      this.bitcnt += 8;
    }
    this.bitbuf = val >>> need; /* 逻辑右移，保持无符号 */
    this.bitcnt -= need;
    return val & ((1 << need) - 1);
  };

  /* 由码长数组构建规范霍夫曼表（puff: construct） */
  function construct(h, length, code) {
    var symbol, len, left, offs = [];
    for (len = 0; len <= MAXBITS; len++) h.count[len] = 0;
    for (symbol = 0; symbol < length; symbol++) h.count[code[symbol]]++;
    if (h.count[0] === length) return 0; /* 无任何码 */
    left = 1;
    for (len = 1; len <= MAXBITS; len++) {
      left <<= 1;
      left -= h.count[len];
      if (left < 0) return left; /* 过定 */
    }
    offs[1] = 0;
    for (len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + h.count[len];
    for (symbol = 0; symbol < length; symbol++) {
      if (code[symbol] !== 0) h.symbol[offs[code[symbol]]++] = symbol;
    }
    return left;
  }

  /* 逐位解码一个霍夫曼符号（puff: decode） */
  function decode(s, h) {
    var code = 0, first = 0, index = 0, len, count, bit;
    for (len = 1; len <= MAXBITS; len++) {
      bit = s.bits(1);
      if (bit < 0) return bit;
      code |= bit;
      count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    return -10;
  }

  /* 解码一段霍夫曼块（puff: codes） */
  function codes(s, hc, hd) {
    for (;;) {
      var symbol = decode(s, hc);
      if (symbol < 0) return symbol;
      if (symbol < 256) {
        s.put(symbol);
      } else if (symbol > 256) {
        symbol -= 257;
        if (symbol >= 29) return -10;
        var len = LENS[symbol] + s.bits(LEXT[symbol]);
        if (len < 0) return len;
        var dsym = decode(s, hd);
        if (dsym < 0) return dsym;
        if (dsym >= 30) return -10;
        var dist = DISTS[dsym] + s.bits(DEXT[dsym]);
        if (dist < 0) return dist;
        if (dist > s.outlen) return -11; /* 距离超出已有输出 */
        s.ensure(len);
        while (len-- > 0) {
          s.out[s.outlen] = s.out[s.outlen - dist];
          s.outlen++;
        }
      } else {
        return 0; /* 256 = 块结束 */
      }
    }
  }

  /* 未压缩块（puff: stored） */
  function stored(s) {
    s.bitbuf = 0;
    s.bitcnt = 0;
    if (s.pos + 4 > s.data.length) return -1;
    var len = s.data[s.pos] | (s.data[s.pos + 1] << 8);
    var nlen = s.data[s.pos + 2] | (s.data[s.pos + 3] << 8);
    s.pos += 4;
    if ((len ^ 0xffff) !== nlen) return -3;
    if (s.pos + len > s.data.length) return -1;
    s.ensure(len);
    s.out.set(s.data.subarray(s.pos, s.pos + len), s.outlen);
    s.outlen += len;
    s.pos += len;
    return 0;
  }

  var fixedBuilt = false;
  var fl = { count: new Array(MAXBITS + 1), symbol: new Array(FIXLCODES) };
  var fd = { count: new Array(MAXBITS + 1), symbol: new Array(MAXDCODES) };
  function buildFixed() {
    var lengths = new Array(FIXLCODES), i;
    for (i = 0; i < 144; i++) lengths[i] = 8;
    for (; i < 256; i++) lengths[i] = 9;
    for (; i < 280; i++) lengths[i] = 7;
    for (; i < 288; i++) lengths[i] = 8;
    construct(fl, FIXLCODES, lengths);
    for (i = 0; i < MAXDCODES; i++) lengths[i] = 5;
    construct(fd, MAXDCODES, lengths);
    fixedBuilt = true;
  }

  /* 动态霍夫曼块（puff: dynamic） */
  function dynamic(s) {
    var nlen = s.bits(5) + 257; if (nlen < 257) return -3;
    var ndist = s.bits(5) + 1; if (ndist < 1) return -3;
    var ncode = s.bits(4) + 4; if (ncode < 4) return -3;
    if (nlen > MAXLCODES || ndist > MAXDCODES || ncode > 19) return -3;

    var clens = new Array(19), index;
    for (index = 0; index < ncode; index++) clens[CLORDER[index]] = s.bits(3);
    for (; index < 19; index++) clens[CLORDER[index]] = 0;

    var cl = { count: new Array(MAXBITS + 1), symbol: new Array(19) };
    var err = construct(cl, 19, clens);
    if (err !== 0) return -3;

    var lens = new Array(MAXLCODES + MAXDCODES);
    index = 0;
    while (index < nlen + ndist) {
      var symbol = decode(s, cl);
      if (symbol < 0) return symbol;
      if (symbol < 16) {
        lens[index++] = symbol;
      } else {
        var rep, val = 0;
        if (symbol === 16) {
          if (index === 0) return -5;
          val = lens[index - 1];
          rep = 3 + s.bits(2);
        } else if (symbol === 17) {
          rep = 3 + s.bits(3);
        } else {
          rep = 11 + s.bits(7);
        }
        if (rep < 0) return rep;
        if (index + rep > nlen + ndist) return -5;
        while (rep-- > 0) lens[index++] = val;
      }
    }
    if (lens[256] === 0) return -9; /* 缺块结束码 */

    var lh = { count: new Array(MAXBITS + 1), symbol: new Array(MAXLCODES) };
    err = construct(lh, nlen, lens);
    if (err < 0) return err;
    var ld = { count: new Array(MAXBITS + 1), symbol: new Array(MAXDCODES) };
    err = construct(ld, ndist, lens.slice(nlen));
    if (err < 0) return err;

    return codes(s, lh, ld);
  }

  function inflateRaw(data) {
    var s = new State(data);
    var last, type, err = 0;
    do {
      last = s.bits(1); if (last < 0) { err = last; break; }
      type = s.bits(2); if (type < 0) { err = type; break; }
      if (type === 0) {
        err = stored(s);
      } else if (type === 1) {
        if (!fixedBuilt) buildFixed();
        err = codes(s, fl, fd);
      } else if (type === 2) {
        err = dynamic(s);
      } else {
        err = -2;
      }
    } while (err === 0 && !last);
    if (err !== 0) throw new Error('inflate 解压失败 (err=' + err + ')');
    return s.out.subarray(0, s.outlen);
  }

  return inflateRaw;
})();
