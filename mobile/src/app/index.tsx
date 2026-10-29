import { Redirect } from 'expo-router';
import { useSession } from '../lib/session';

export default function Index() {
  const { agent } = useSession();
  return <Redirect href={agent ? '/today' : '/login'} />;
}
