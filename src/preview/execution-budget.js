// 作品のループが同じタスクの中で実時間を使い続けたら、例外で制御をブラウザへ戻す。
// 実行時の仮想時計を差し替える前に、実時間と別タスクへの通知手段を確保する。
const __canvasCheckExecution = (() => {
  const now = performance.now.bind(performance);
  const BudgetError = Error;
  const channel = new MessageChannel();
  const wake = channel.port2.postMessage.bind(channel.port2);
  let deadline = null;
  let failure = null;
  channel.port1.onmessage = () => { deadline = null; };
  return (line, column) => {
    if (failure) throw failure;
    const time = now();
    if (deadline === null) {
      deadline = time + 750;
      wake(null);
    } else if (time >= deadline) {
      failure = new BudgetError(`ループが 750ms 以内に制御を返さなかった（作品の ${line} 行 ${column} 列）`);
      throw failure;
    }
  };
})();
