import { notFound } from 'next/navigation';
import { CheckoutForm } from './checkout-form';

type Props = {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ offer?: string }>;
};

const UUID = /^[0-9a-f-]{36}$/i;

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { listingId } = await params;
  const { offer } = await searchParams;
  if (!UUID.test(listingId) || (offer !== undefined && !UUID.test(offer))) notFound();
  return <CheckoutForm listingId={listingId} offerId={offer ?? null} />;
}
