import type { StoryProject } from '@shared/schema'

/**
 * 内置示例工程：「翡翠旅店的夜晚」
 * 演示对白、选项、变量操作、条件选项与多结局。
 */
export function sampleProject(): StoryProject {
  // 变量
  const vCoin = 'v_coin'
  const vTrust = 'v_trust'

  // 节点
  const nStart = 'n_start'
  const nNarr1 = 'n_narr1'
  const nChoice1 = 'n_choice1'
  const nVarPay = 'n_var_pay'
  const nVarDrink = 'n_var_drink'
  const nInn = 'n_inn'
  const nEndSleep = 'n_end_sleep'
  const nTavern = 'n_tavern'
  const nChoiceInn = 'n_choice_inn'
  const nVarTalk = 'n_var_talk'
  const nOldman = 'n_oldman'
  const nChoice2 = 'n_choice2'
  const nEndSecret = 'n_end_secret'
  const nEndRoad = 'n_end_road'
  const nEndStreet = 'n_end_street'

  // 选项（选项 id 即连线端口 sourceHandle）
  const oPay = 'o_pay'
  const oSave = 'o_save'
  const oDrink = 'o_drink'
  const oTalk = 'o_talk'
  const oSilent = 'o_silent'
  const oAsk = 'o_ask'
  const oJoin = 'o_join'

  return {
    version: 3,
    meta: {
      title: '翡翠旅店的夜晚',
      author: 'StoryLoom',
      description: '一个演示工程：暴雪夜的旅店里，你的每个选择都会被记住。'
    },
    assets: {},
    customCss: '',
    customJs: '',
    variables: [
      { id: vCoin, name: '金币', type: 'number', initial: 5 },
      { id: vTrust, name: '信任', type: 'number', initial: 0 }
    ],
    nodes: [
      { id: nStart, type: 'start', position: { x: -60, y: 260 }, data: {} },
      {
        id: nNarr1,
        type: 'dialogue',
        position: { x: 180, y: 250 },
        data: {
          speaker: '',
          text: '暴雪把山路封死的那个傍晚，你推开了翡翠旅店的门。\n大堂里只剩最后一点炉火，和一位坐在角落、看不清面容的老者。'
        }
      },
      {
        id: nChoice1,
        type: 'choice',
        position: { x: 520, y: 250 },
        data: {
          options: [
            { id: oPay, text: '付 3 枚金币，要一间带炉火的房', condition: null },
            { id: oSave, text: '省下钱，在大堂的长椅上凑合一晚', condition: null },
            { id: oDrink, text: '坐到老者对面，请他喝一杯热酒', condition: null }
          ]
        }
      },
      {
        id: nVarPay,
        type: 'variable',
        position: { x: 880, y: 40 },
        data: { ops: [{ id: 'op_pay', variableId: vCoin, op: 'sub', value: 3 }] }
      },
      {
        id: nVarDrink,
        type: 'variable',
        position: { x: 900, y: 250 },
        data: {
          ops: [
            { id: 'op_drink1', variableId: vCoin, op: 'sub', value: 2 },
            { id: 'op_drink2', variableId: vTrust, op: 'add', value: 2 }
          ]
        }
      },
      {
        id: nInn,
        type: 'dialogue',
        position: { x: 1130, y: 40 },
        data: { speaker: '店家', text: '三楼右数第二间，被子是新晒的。夜里风大，别开窗。' }
      },
      { id: nEndSleep, type: 'end', position: { x: 1400, y: 40 }, data: { label: '一夜好眠' } },
      {
        id: nTavern,
        type: 'dialogue',
        position: { x: 880, y: 440 },
        data: {
          speaker: '',
          text: '你把外套裹紧，缩在长椅上。炉火明明灭灭，老者的影子在墙上忽长忽短。\n他似乎一直在等你开口，又似乎根本没注意到你。'
        }
      },
      {
        id: nChoiceInn,
        type: 'choice',
        position: { x: 1160, y: 440 },
        data: {
          options: [
            { id: oTalk, text: '主动开口，问他从哪里来', condition: null },
            { id: oSilent, text: '太累了，什么都别问，闭目养神', condition: null }
          ]
        }
      },
      {
        id: nVarTalk,
        type: 'variable',
        position: { x: 1440, y: 340 },
        data: { ops: [{ id: 'op_talk', variableId: vTrust, op: 'add', value: 1 }] }
      },
      {
        id: nOldman,
        type: 'dialogue',
        position: { x: 1440, y: 620 },
        data: {
          speaker: '老者',
          text: '「年轻人，你信不信，这座山里藏着一条只在雪夜里显形的路。」\n他呷了口酒，「三十年前，我从那条路上回来。同行的人，没有。」'
        }
      },
      {
        id: nChoice2,
        type: 'choice',
        position: { x: 1740, y: 620 },
        data: {
          options: [
            { id: oAsk, text: '追问那条路的下落', condition: null },
            { id: oJoin, text: '「带我走。」你想都没想就说', condition: { variableId: vTrust, op: '>=', value: 2 } }
          ]
        }
      },
      { id: nEndSecret, type: 'end', position: { x: 2050, y: 540 }, data: { label: '雪夜秘辛' } },
      { id: nEndRoad, type: 'end', position: { x: 2050, y: 720 }, data: { label: '结伴同行' } },
      { id: nEndStreet, type: 'end', position: { x: 1160, y: 700 }, data: { label: '平凡一夜' } }
    ],
    edges: [
      { id: 'e01', source: nStart, sourceHandle: null, target: nNarr1 },
      { id: 'e02', source: nNarr1, sourceHandle: null, target: nChoice1 },

      { id: 'e10', source: nChoice1, sourceHandle: oPay, target: nVarPay },
      { id: 'e11', source: nChoice1, sourceHandle: oSave, target: nTavern },
      { id: 'e12', source: nChoice1, sourceHandle: oDrink, target: nVarDrink },
      { id: 'e13', source: nVarDrink, sourceHandle: null, target: nOldman },

      { id: 'e20', source: nVarPay, sourceHandle: null, target: nInn },
      { id: 'e21', source: nInn, sourceHandle: null, target: nEndSleep },

      { id: 'e30', source: nTavern, sourceHandle: null, target: nChoiceInn },
      { id: 'e31', source: nChoiceInn, sourceHandle: oTalk, target: nVarTalk },
      { id: 'e32', source: nChoiceInn, sourceHandle: oSilent, target: nEndStreet },

      { id: 'e40', source: nVarTalk, sourceHandle: null, target: nOldman },
      { id: 'e50', source: nOldman, sourceHandle: null, target: nChoice2 },
      { id: 'e51', source: nChoice2, sourceHandle: oAsk, target: nEndSecret },
      { id: 'e52', source: nChoice2, sourceHandle: oJoin, target: nEndRoad }
    ]
  }
}
