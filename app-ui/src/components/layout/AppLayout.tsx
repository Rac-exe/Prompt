import { ReactNode } from "react";

interface AppLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
}

export const AppLayout = ({ children, sidebar }: AppLayoutProps) => {
  return (
    <div className="h-screen flex w-full bg-background overflow-hidden">
      <div className="flex-shrink-0">{sidebar}</div>
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
};
