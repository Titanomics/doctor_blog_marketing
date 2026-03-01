"use client";

import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import ModeSelect from "@/components/ModeSelect";
import Sidebar from "@/components/dashboard/Sidebar";
import MainPanel from "@/components/dashboard/MainPanel";
import ReporterPanel from "@/components/dashboard/ReporterPanel";
import { Client, CafeClient } from "@/lib/types";

type AnyClient = Client | CafeClient;

export default function DashboardPage() {
  const [mode, setMode] = useState<"blog" | "cafe" | "reporter" | null>(null);
  const [selectedClient, setSelectedClient] = useState<AnyClient | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleModeChange = () => {
    setMode(null);
    setSelectedClient(null);
  };

  const handleClientSelect = (client: AnyClient) => {
    setSelectedClient(client);
    setSidebarOpen(false);
  };

  const handleClientUpdated = () => {
    setSelectedClient(null);
    setRefreshTrigger((n) => n + 1);
  };

  // reporter 모드는 cafe_clients를 Sidebar에서 사용
  const sidebarMode = mode === "reporter" ? "cafe" : mode;

  return (
    <AuthGuard>
      {mode === null ? (
        <ModeSelect onSelect={setMode} />
      ) : (
        <div className="min-h-screen bg-slate-50 flex relative">
          {/* 모바일 햄버거 버튼 */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden fixed top-4 left-4 z-40 bg-white shadow-md rounded-xl p-2.5 border border-slate-200"
          >
            <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* 모바일 오버레이 */}
          {sidebarOpen && (
            <div
              className="md:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* 사이드바 */}
          <div
            className={`
              fixed md:static inset-y-0 left-0 z-50
              transform transition-transform duration-300 ease-in-out
              ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
              md:translate-x-0
            `}
          >
            <Sidebar
              mode={sidebarMode as "blog" | "cafe"}
              productSubMode={mode === "reporter" ? "reporter" : mode === "cafe" ? "cafe" : undefined}
              onModeChange={handleModeChange}
              selectedClientId={selectedClient?.id ?? null}
              onClientSelect={handleClientSelect}
              refreshTrigger={refreshTrigger}
              onClientListChanged={handleClientUpdated}
            />
          </div>

          {mode === "reporter" ? (
            <ReporterPanel
              client={selectedClient as CafeClient | null}
              onClientUpdated={handleClientUpdated}
            />
          ) : (
            <MainPanel
              mode={mode}
              client={selectedClient}
              onClientUpdated={handleClientUpdated}
            />
          )}
        </div>
      )}
    </AuthGuard>
  );
}
