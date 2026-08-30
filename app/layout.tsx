import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "@/adapters/memory/store";
import { AppShell } from "@/ui/app-shell";

export const metadata: Metadata = {
  title: "AI WORK HUB",
  description: "次に何をすればよいかを提示し、業務完遂までナビゲートします",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <StoreProvider>
          <AppShell>{children}</AppShell>
        </StoreProvider>
      </body>
    </html>
  );
}
