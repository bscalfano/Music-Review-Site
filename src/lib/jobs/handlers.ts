import { enrichAlbum } from "@/lib/albums/enrich";
import { resolveAlbumLinks } from "@/lib/albums/links";
import { sendNotificationEmail } from "@/lib/social/notification-email";
import type { JobPayloads, JobType } from "./queue";

export type JobHandlers = { [K in JobType]: (payload: JobPayloads[K]) => Promise<void> };

/** One handler per job type. Handlers must be idempotent: jobs are retried after failures. */
export const handlers: JobHandlers = {
  enrich_album: ({ albumId }) => enrichAlbum(albumId),
  resolve_links: async ({ albumId }) => void (await resolveAlbumLinks(albumId)),
  notification_email: ({ notificationId }) => sendNotificationEmail(notificationId),
};
