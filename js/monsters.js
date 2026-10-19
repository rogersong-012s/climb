import { GAME_CONFIG } from './config.js';

export const QTE_ITEM_PRESENTATIONS = Object.freeze({
  ddm: Object.freeze({
    id: 'ddm',
    name: 'DDM 產品',
    visual: 'image',
    productImage: true,
    assetPath: './assets/qte/products/ddm.png',
    visualScale: 1.05,
    fallbackText: 'DDM',
    accent: 'blue'
  }),
  mask: Object.freeze({
    id: 'mask',
    name: '面具',
    visual: 'image',
    assetPath: './assets/qte/alternatives/mask.png',
    visualScale: 1,
    fallbackText: '面具',
    accent: 'orange'
  }),
  nne: Object.freeze({
    id: 'nne',
    name: 'NNE 產品',
    visual: 'image',
    productImage: true,
    assetPath: './assets/qte/products/nne.png',
    visualScale: 1.02,
    fallbackText: 'NNE',
    accent: 'blue'
  }),
  nap: Object.freeze({
    id: 'nap',
    name: 'NAP 產品',
    visual: 'image',
    productImage: true,
    assetPath: './assets/qte/products/nap.png',
    visualScale: 1.12,
    fallbackText: 'NAP',
    accent: 'blue'
  }),
  opium: Object.freeze({
    id: 'opium',
    name: 'OPIUM 替代解法',
    visual: 'image',
    assetPath: './assets/qte/alternatives/opium.png',
    visualScale: 1.18,
    fallbackText: 'OPIUM',
    accent: 'orange'
  }),
  'closed-eyes': Object.freeze({
    id: 'closed-eyes',
    name: '閉上雙眼',
    visual: 'image',
    assetPath: './assets/qte/alternatives/off.png',
    visualScale: 1,
    fallbackText: '閉眼',
    accent: 'orange'
  }),
  pan: Object.freeze({ id: 'pan', name: '平底鍋', visual: 'wordmark', fallbackText: 'PAN', accent: 'orange' }),
  yss: Object.freeze({ id: 'yss', name: 'YSS 產品', visual: 'image', productImage: true, assetPath: './assets/qte/products/yss.png', visualScale: 1.38, fallbackText: 'YSS', accent: 'blue' }),
  diet: Object.freeze({ id: 'diet', name: '節食餐盤', visual: 'image', assetPath: './assets/qte/alternatives/diet.png', visualScale: 1, fallbackText: 'DIET', accent: 'orange' })
});

export const MONSTERS = Object.freeze([
  {
    // Keep the existing stable id for the first scheduled monster.
    id: 'muscle',
    name: '皮膚怪',
    debuffType: 'BLACK_SPOTS',
    spell: '黑斑魔法',
    failureKnockback: 3,
    failureDebuff: { type: 'BLACK_SPOTS', durationFloors: 5 },
    solutions: [
      {
        word: 'DDM+1', description: '解除皮膚怪的黑斑', effect: 'CURE', debuffType: 'BLACK_SPOTS', itemId: 'ddm',
        itemMessage: '使用 DDM+1，成功解除負面狀態！',
        emergencyMessage: '成功避免這次負面狀態'
      },
      {
        word: 'MASK', description: '戴上面具暫時遮擋', effect: 'NONE', itemId: 'mask',
        itemMessage: '戴上面具暫時遮擋，避免病灶惡化！',
        emergencyMessage: '成功避免這次負面狀態'
      }
    ]
  },
  {
    id: 'eyes',
    name: '眼睛怪',
    debuffType: 'BLUR',
    spell: '視野模糊魔法',
    failureKnockback: 3,
    failureDebuff: { type: 'BLUR', durationFloors: 5 },
    solutions: [
      { word: 'NNE+1', description: '解除眼睛怪的視野模糊', effect: 'CURE', debuffType: 'BLUR', itemId: 'nne', itemMessage: '使用 NNE+1，成功解除負面狀態！', emergencyMessage: '成功避免這次負面狀態' },
      { word: 'OFF', description: '閉上雙眼，縮短負面狀態', effect: 'REDUCE_DEBUFF_DURATION', debuffType: 'BLUR', durationMultiplier: 0.5, itemId: 'closed-eyes', itemMessage: '閉上雙眼，負面狀態持續樓層減半！', emergencyMessage: '成功避免這次負面狀態' }
    ]
  },
  {
    id: 'pain',
    name: '疼痛怪',
    debuffType: 'PAIN',
    spell: '疼痛魔法',
    failureKnockback: 3,
    failureDebuff: { type: 'PAIN', durationFloors: 5 },
    solutions: [
      {
        word: 'NAP+1', description: '解除疼痛狀態', effect: 'CURE', debuffType: 'PAIN', itemId: 'nap',
        itemMessage: '使用 NAP+1，成功解除疼痛狀態！',
        emergencyMessage: '成功避免這次負面狀態'
      },
      {
        word: 'OPIUM', description: '解除疼痛，但引發心悸', effect: 'CURE_AND_APPLY_DEBUFF', debuffType: 'PAIN',
        debuff: { type: 'HEART_PALPITATIONS', durationFloors: 5 }, itemId: 'opium',
        itemMessage: '使用 OPIUM，解除疼痛並承受 5F 心悸！',
        emergencyMessage: '成功避免這次負面狀態'
      }
    ]
  },
  {
    id: 'obese',
    name: '肥胖怪',
    debuffType: 'OBESITY',
    spell: '肥胖魔法',
    failureKnockback: 5,
    failureDebuff: { type: 'OBESITY', durationFloors: 5 },
    solutions: [
      {
        word: 'YSS+2', description: '解除肥胖狀態', effect: 'CURE', debuffType: 'OBESITY', itemId: 'yss',
        itemMessage: '使用 YSS+2，成功解除負面狀態！', emergencyMessage: '成功避免這次負面狀態'
      },
      {
        word: 'DIET', description: '解除肥胖，但可能引發低血糖', effect: 'CURE_AND_APPLY_DEBUFF', debuffType: 'OBESITY',
        debuff: { type: 'LOW_BLOOD_SUGAR', durationFloors: GAME_CONFIG.lowBloodSugarDurationFloors }, itemId: 'diet',
        itemMessage: '透過節食減輕負擔，卻引發了低血糖！', emergencyMessage: '成功避免這次負面狀態'
      }
    ]
  }
]);

export function chooseMonster(random = Math.random, monsters = MONSTERS) {
  return monsters[Math.floor(random() * monsters.length)] ?? monsters[0];
}
