"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Sidebar from "@/components/dashboard/Sidebar";
import MainPanel from "@/components/dashboard/MainPanel";
import { Client } from "@/lib/types";

export default function DashboardPage() {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
  };

  const handleClientUpdated = () => {
    setSelectedClient(null);
    setRefreshTrigger((n) => n + 1);
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-slate-50 flex">
        <Sidebar
          selectedClientId={selectedClient?.id ?? null}
          onClientSelect={handleClientSelect}
          refreshTrigger={refreshTrigger}
          onClientListChanged={handleClientUpdated}
        />
        <MainPanel
          client={selectedClient}
          onClientUpdated={handleClientUpdated}
        />
      </div>
    </AuthGuard>
  );
}
