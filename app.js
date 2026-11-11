// 记账本小程序入口
const store = require('./utils/store');
const recurring = require('./utils/recurring');

App({
  onLaunch() {
    // 初始化本地存储，确保首次启动时记录数组存在
    store.init();
    // 补齐到期的周期账单（房租、订阅、工资等）
    try {
      const n = recurring.materialize();
      if (n > 0) {
        // 延迟提示，等首页渲染完
        setTimeout(() => {
          wx.showToast({ title: '已自动记入 ' + n + ' 笔周期账单', icon: 'none', duration: 2600 });
        }, 800);
      }
    } catch (e) { /* 忽略，避免影响启动 */ }
  },
  globalData: {}
});
