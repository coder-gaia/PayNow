import { redirect } from 'next/navigation';

/** O middleware decide para onde ir conforme exista sessão ou não. */
export default function Home() {
  redirect('/painel');
}
