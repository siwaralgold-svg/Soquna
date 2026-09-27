import { notFound } from 'next/navigation';
import { OrderScreen } from './order-screen';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <OrderScreen orderId={id} />;
}
