import { notFound } from 'next/navigation';
import { ChatScreen } from './chat-screen';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offer?: string }>;
};

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ChatPage({ params, searchParams }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { offer } = await searchParams;
  return <ChatScreen conversationId={id} startWithOffer={offer === '1'} />;
}
