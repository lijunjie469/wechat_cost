/* 交易自动归类（由 utils/classify.js 生成，两边规则必须一致） */
(function () {
  'use strict';

  // 交易自动归类：关键词 -> 分类 id（顺序即优先级，先命中先归类）
  // 规则来自 D:\bank-statement-analyzer\analyzer\categorize.py 的 15 类关键词，
  // 按本项目的 10 个支出分类 / 6 个收入分类重新归并。
  //
  // 刻意不收的高危词：「支付宝」「微信支付」「消费」「扫码」「收款」「付款」——
  // 微信支付账单里几乎每行都带这些字样，收进来等于把所有记录都判成一类。

  var EXPENSE_RULES = [
    // 退款/冲正优先于其它（否则「XX退款」会被餐饮/购物抢走）
    { id: 'other', words: ['退款', '退回', '返还', '冲正', '撤销'] },
    { id: 'food', words: [
      '餐', '饭', '美食', '食', '烧烤', '火锅', '麻辣烫', '咖啡', '奶茶', '茶饮', '饮料',
      '麦当劳', '肯德基', 'kfc', '星巴克', '瑞幸', '喜茶', '蜜雪', '汉堡', '面馆', '小吃',
      '食堂', '外卖', '美团', '饿了么', '拉扎斯', '百味煨', '牛肉', '烧腊', '甜品', '早餐', '米粉',
      '馄饨', '包子', '拉面', '饺子', '水饺', '米线', '狮头鹅', '卤味', '烧鹅', '螺蛳粉',
      '粥', '肠粉', '茶餐厅', '快餐', '烤鱼', '日料', '寿司', '披萨', '蛋糕', '面包', '水果',
      '食品', '饮品'
    ] },
    { id: 'transport', words: [
      '打车', '滴滴', '高德', '曹操', '出租', '地铁', '公交', '巴士', '加油', '中石化', '中石油',
      '停车', '高速', 'etc', '12306', '火车', '高铁', '铁路', '机票', '航空', '共享单车',
      '哈啰', '青桔', '摩拜', '过路费', '洗车', '一卡通', '携程'
    ] },
    { id: 'comm', words: [
      '话费', '流量', '宽带', '中国移动', '中国联通', '中国电信', '移动通信', '联通', '电信',
      '电话费', '充值中心', '通信费', '有线电视'
    ] },
    { id: 'house', words: [
      '房租', '租金', '物业', '水费', '电费', '燃气', '取暖', '供暖', '家装', '家具', '宜家',
      '装修', '家政', '保洁', '房东', '租房', '公寓', '中介', '水电', '房贷', '住房贷款',
      '按揭', '公积金'
    ] },
    { id: 'medical', words: [
      '医院', '药', '诊所', '体检', '医疗', '挂号', '口腔', '牙科', '眼科', '卫生院', '医保'
    ] },
    { id: 'edu', words: [
      '书店', '图书', '当当', '课程', '教育', '培训', '学费', '网课', '知识', '得到', '考试', '文具'
    ] },
    { id: 'fun', words: [
      '电影', '影城', '影院', '游戏', 'steam', 'ktv', '音乐', '视频', '会员', '票务', '演唱会',
      '话剧', '网吧', '爱奇艺', '优酷', '腾讯视频', 'b站', '哔哩哔哩', '景区', '门票', '旅游',
      '酒店', '健身', '娱乐', '王者荣耀', '点券', '腾讯天游', '网易游戏', '外设',
      '深度求索', 'deepseek', 'chatgpt', 'openai', 'claude', '订阅'
    ] },
    { id: 'shopping', words: [
      '超市', '便利店', '百货', '淘宝', '天猫', '京东', '拼多多', '商场', '购物', '商城', '转转',
      '旗舰店', '优衣库', '服装', '鞋', '内衣', '数码', '小米', '苹果', '华为', '苏宁',
      '唯品会', '抖音商城', '山姆', '沃尔玛', '永辉', '美妆', '屈臣氏', '生鲜', '菜市场',
      '盒马', '联想', '笔记本', '电脑', '内存', '电器', '国美', '商行'
    ] },
    // 支出侧手续费单列不出来（本项目没有该分类），直接落到 other，不占位
    { id: 'social', words: [
      '红包', '转账', '礼金', '份子', '人情', '随礼', '孝心', '群收款', '压岁钱', '汇款'
    ] }
  ];

  var INCOME_RULES = [
    { id: 'other_in', words: ['退款', '退回', '返还', '冲正', '撤销'] },
    { id: 'salary', words: ['工资', '薪资', '薪', '代发'] },
    { id: 'bonus', words: ['奖金', '年终奖', '绩效', '提成', '补贴', '报销'] },
    { id: 'invest', words: [
      '收益', '利息', '基金', '余额宝', '零钱通', '理财', '分红', '股票', '证券', '保险',
      '存款', '定期', '贵金属', '朝朝宝', '国债'
    ] },
    { id: 'parttime', words: ['兼职', '劳务', '稿费', '外快', '佣金'] },
    { id: 'hongbao', words: ['红包', '转账', '收款', '礼金', '压岁钱'] }
  ];

  // 判断一段文本（商品说明/商户名/摘要/交易对方）属于哪个分类
  function pickCategory(type, text) {
    var rules = type === 'income' ? INCOME_RULES : EXPENSE_RULES;
    var t = String(text || '').toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      var words = rules[i].words;
      for (var j = 0; j < words.length; j++) {
        if (t.indexOf(String(words[j]).toLowerCase()) >= 0) return rules[i].id;
      }
    }
    return type === 'income' ? 'other_in' : 'other';
  }



  // ---- 商家识别 ----
  // 银行流水和微信账单里，「交易对方」经常是支付渠道或摘要词（支付宝、微信支付、快捷支付…），
  // 直接拿去展示等于没说「钱给了谁」。这里优先取真正的商户名，渠道词则退回备注，
  // 两者都只是渠道时明确标成「XX（渠道）」，避免统计里出现一堆同名的「支付宝」。
  var CHANNEL_WORD = /^(微信支付|微信|财付通|财付通支付科技有限公司|支付宝|支付宝中国网络技术有限公司|支付宝中国网络技术有限公司浙江分公司|深圳市腾讯计算机系统有限公司|财付通支付科技有限公司|中国银联|银联|银联电子支付|云闪付|快捷支付|银联快捷支付|银联无卡自助消费|银联线上有卡支付|商户消费|消费|转账|微信转账|信用卡还款|还款|其他|未命名|未标注商家)$/;

  // 比较用的归一化：去掉空白与常见标点，让「支付宝（中国）网络技术有限公司」也能命中渠道表
  function squeeze(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[\s（）()【】\[\]·、,，.。\/\-]/g, '');
  }

  // 支付宝/电商账单里「交易对方」常是平台名（淘宝闪购、饿了么），真正的商家在「商品说明」里
  var PLATFORM_WORD = /^(淘宝闪购|淘宝|天猫|饿了么|美团|美团外卖|京东|京东商城|拼多多|抖音|抖音电商|淘票票|猫眼|盒马|山姆|沃尔玛|永辉)$/;

  function merchantOf(rec) {
    var party = String(rec && rec.party ? rec.party : '').trim();
    var note = String(rec && rec.note ? rec.note : '').trim();
    var isChan = function (s) { return !!s && CHANNEL_WORD.test(squeeze(s)); };
    // 平台名不算商家：从商品说明里取具体店铺
    // 只在「商品说明」是订单描述时替换（如「蜀渝拌·重庆凉拌菜(林头市场店)外卖订单」）
    if (party && PLATFORM_WORD.test(squeeze(party)) && /订单$/.test(note)) {
      var shop = note.replace(/\s*(外卖)?订单$/, '').replace(/-?消费$/, '').trim();
      if (shop && shop.length >= 2 && !PLATFORM_WORD.test(squeeze(shop))) return shop.slice(0, 20);
    }
    if (party && !isChan(party)) return party;
    if (note && !isChan(note)) return note;
    return '未标注商家';
  }

  // 支付渠道：和商家是两个维度，界面上要同时显示（「支付宝 · 麦当劳」而不是二选一）
  function channelOf(rec) {
    if (!rec) return '';
    var t = squeeze(rec.party) + '|' + squeeze(rec.note) + '|' + squeeze(rec.tradeType) + '|' + squeeze(rec.payType);
    if (/支付宝/.test(t)) return '支付宝';
    if (/财付通|微信|腾讯/.test(t)) return '微信';
    if (/银联|云闪付/.test(t)) return '银联';
    if (rec.source === 'wechat') return '微信';   // 微信支付账单导出的，默认算微信渠道
    if (rec.source === 'alipay') return '支付宝';  // 支付宝账单导出的
    return '';
  }

  const WC = window.WC = window.WC || {};
  WC.classify = { EXPENSE_RULES: EXPENSE_RULES, INCOME_RULES: INCOME_RULES, pickCategory: pickCategory, merchantOf: merchantOf, channelOf: channelOf };
})();
