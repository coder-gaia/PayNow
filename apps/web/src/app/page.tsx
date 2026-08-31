import { redirect } from 'next/navigation';

/** O middleware decide para onde ir conforme exista sessao ou nao. */
export default function Home() {
  redirect('/painel');
}
