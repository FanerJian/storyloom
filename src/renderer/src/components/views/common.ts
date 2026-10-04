import { toast } from '../../stores/toast'

/** 视图组件共享的容错执行：业务动作抛错时转为 toast，不打断渲染。 */
export const safely = (action: () => void): void => { try { action() } catch (e) { toast.error(String(e)) } }
