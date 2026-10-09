export const MONSTERS = Object.freeze([
  {
    id: 'muscle',
    name: '肌肉怪',
    spell: '痠痛魔法',
    qteDurationMs: 6000,
    failureKnockback: 4,
    failureDebuff: { type: 'SORE', durationFloors: 5 },
    solutions: [
      { word: 'DRUG', description: '解除痠痛魔法', effect: 'CURE', debuffType: 'SORE' },
      { word: 'PAN', description: '平底鍋打倒怪物，留下 5 層痠痛', effect: 'PAN_ATTACK', debuff: { type: 'SORE', durationFloors: 5 } }
    ]
  },
  {
    id: 'eyes',
    name: '眼睛怪',
    spell: '視野模糊魔法',
    qteDurationMs: 6000,
    failureKnockback: 3,
    failureDebuff: { type: 'BLUR', durationFloors: 5 },
    solutions: [
      { word: 'EYE', description: '解除視野模糊魔法', effect: 'CURE', debuffType: 'BLUR' },
      { word: 'PAN', description: '打倒怪物，留下 4 層視野模糊', effect: 'PAN_ATTACK', debuff: { type: 'BLUR', durationFloors: 4 } }
    ]
  },
  {
    id: 'tired',
    name: '疲勞怪',
    spell: '疲勞魔法',
    qteDurationMs: 6000,
    failureKnockback: 5,
    failureDebuff: { type: 'FATIGUE', durationFloors: 5 },
    solutions: [
      { word: 'REST', description: '解除疲勞魔法', effect: 'CURE', debuffType: 'FATIGUE' },
      { word: 'COFFEE', description: '成功通過，留下 3 層疲勞', effect: 'APPLY_DEBUFF', debuff: { type: 'FATIGUE', durationFloors: 3 } }
    ]
  }
]);

export function chooseMonster(random = Math.random, monsters = MONSTERS) {
  return monsters[Math.floor(random() * monsters.length)] ?? monsters[0];
}
