import BookingPage from "@/components/BookingPage";

export const dynamic = "force-dynamic";

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BookingPage slug={slug} />;
}
