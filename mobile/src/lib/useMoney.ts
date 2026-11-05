import { kvJson } from './db';
import { useDb } from './session';
import { MONEY_KEY, type MyMoney } from './money';

/** My partners' payments and my incentives, as last fetched (kept on the phone for no-signal days). */
export function useMoney(): MyMoney | null {
  return useDb(() => kvJson<MyMoney | null>(MONEY_KEY, null));
}
