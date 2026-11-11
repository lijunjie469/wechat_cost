// 收支分类定义（emoji 图标，无需图片资源）
const EXPENSE = [
  { id: 'food', name: '餐饮', icon: '🍜' },
  { id: 'transport', name: '交通', icon: '🚌' },
  { id: 'shopping', name: '购物', icon: '🛍️' },
  { id: 'fun', name: '娱乐', icon: '🎮' },
  { id: 'house', name: '住房', icon: '🏠' },
  { id: 'medical', name: '医疗', icon: '💊' },
  { id: 'edu', name: '学习', icon: '📚' },
  { id: 'comm', name: '通讯', icon: '📱' },
  { id: 'social', name: '人情', icon: '🧧' },
  { id: 'other', name: '其他', icon: '📦' }
];

const INCOME = [
  { id: 'salary', name: '工资', icon: '💰' },
  { id: 'bonus', name: '奖金', icon: '🎉' },
  { id: 'invest', name: '理财', icon: '📈' },
  { id: 'parttime', name: '兼职', icon: '💼' },
  { id: 'hongbao', name: '红包', icon: '🧧' },
  { id: 'other_in', name: '其他', icon: '📦' }
];

function list(type) {
  return type === 'income' ? INCOME : EXPENSE;
}

// 按 id 查分类，找不到时回退到"其他"
function byId(type, id) {
  const arr = list(type);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].id === id) return arr[i];
  }
  return arr[arr.length - 1];
}

module.exports = {
  EXPENSE: EXPENSE,
  INCOME: INCOME,
  list: list,
  byId: byId
};
