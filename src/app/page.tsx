import { siteConfig } from "@/config/site";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{siteConfig.name}</h1>
      <p className="text-muted-foreground">{siteConfig.tagline}</p>
    </main>
  );
}
