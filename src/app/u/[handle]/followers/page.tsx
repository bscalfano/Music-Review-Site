import type { Metadata } from "next";
import { FollowListPage } from "../follow-list";

type Props = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  return { title: `followers of @${handle}`, robots: { index: false } };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ handle }, { page }] = await Promise.all([params, searchParams]);
  return <FollowListPage direction="followers" handle={handle} pageParam={page} />;
}
