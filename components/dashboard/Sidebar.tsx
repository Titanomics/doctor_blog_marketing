"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Client, CafeClient } from "@/lib/types";
import AddClientModal from "@/components/dashboard/AddClientModal";

type AnyClient = Client | CafeClient;

interface SidebarProps {
  mode: "blog" | "cafe";
  productSubMode?: "cafe" | "reporter";
  onModeChange: () => void;
  selectedClientId: string | null;
  onClientSelect: (client: AnyClient) => void;
  refreshTrigger: number;
  onClientListChanged: () => void;
}

export default function Sidebar({
  mode,
  productSubMode,
  onModeChange,
  selectedClientId,
  onClientSelect,
  refreshTrigger,
  onClientListChanged,
}: SidebarProps) {
  const [clients, setClients] = useState<AnyClient[]>([]);
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [myName, setMyName] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const isBlog = mode === "blog";
  const apiPath = isBlog ? "/api/clients" : "/api/cafe/clients";
  const entityLabel = isBlog ? "병원" : "브랜드";
  const activeColor = isBlog ? "bg-emerald-500" : "bg-violet-500";
  const activeFocus = isBlog ? "focus:border-emerald-400" : "focus:border-violet-400";
  const activeItemBg = isBlog ? "bg-emerald-50 border-emerald-200" : "bg-violet-50 border-violet-200";
  const activeItemText = isBlog ? "text-emerald-700" : "text-violet-700";

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiPath);
      if (res.ok) {
        const data = await res.json();
        setClients(data);
      }
    } finally {
      setLoading(false);
    }
  }, [apiPath]);

  useEffect(() => {
    setClients([]);
    fetchClients();
    const saved = localStorage.getItem("myAssigneeName");
    if (saved) setMyName(saved);
  }, [fetchClients, refreshTrigger]);

  const filteredClients = clients.filter((c) => {
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.assignee.toLowerCase().includes(search.toLowerCase());

    const matchesAssignee =
      assigneeFilter === "all" ||
      (assigneeFilter === "mine" && c.assignee === myName);

    return matchesSearch && matchesAssignee;
  });

  const handleLogout = () => {
    sessionStorage.removeItem("authenticated");
    window.location.href = "/";
  };

  return (
    <aside className="w-72 min-h-screen bg-white border-r border-slate-100 flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center gap-2 p-4 border-b border-slate-100">
        <button
          onClick={onModeChange}
          className="text-gray-400 hover:text-gray-600 text-sm transition-colors"
        >
          ← 돌아가기
        </button>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
          isBlog ? "bg-blue-100 text-blue-700" : productSubMode === "reporter" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"
        }`}>
          {isBlog ? "🏥 병원" : productSubMode === "reporter" ? "📝 블로그기자단" : "☕ 카페"}
        </span>
      </div>

      {/* 필터 영역 */}
      <div className="px-4 pt-4 pb-2 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => setAssigneeFilter("all")}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              assigneeFilter === "all"
                ? `${activeColor} text-white`
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            전체
          </button>
          <button
            onClick={() => setAssigneeFilter("mine")}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              assigneeFilter === "mine"
                ? `${activeColor} text-white`
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            내 {entityLabel}
          </button>
        </div>

        <AnimatePresence>
          {assigneeFilter === "mine" && (
            <motion.input
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              type="text"
              value={myName}
              onChange={(e) => {
                setMyName(e.target.value);
                localStorage.setItem("myAssigneeName", e.target.value);
              }}
              placeholder="내 이름 입력 (예: 김경록)"
              className={`w-full px-3 py-2 text-sm rounded-lg border border-slate-200 ${activeFocus} outline-none text-slate-700 placeholder:text-slate-400`}
            />
          )}
        </AnimatePresence>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`${entityLabel} / 담당자 검색...`}
          className={`w-full px-3 py-2 text-sm rounded-lg border border-slate-200 ${activeFocus} outline-none text-slate-700 placeholder:text-slate-400`}
        />
      </div>

      {/* 리스트 */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">불러오는 중...</div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            {search ? "검색 결과 없음" : `등록된 ${entityLabel} 없음`}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredClients.map((client) => (
              <motion.button
                key={client.id}
                whileHover={{ x: 2 }}
                onClick={() => onClientSelect(client)}
                className={`w-full text-left px-3 py-3 rounded-xl transition-colors ${
                  selectedClientId === client.id
                    ? `border ${activeItemBg}`
                    : "hover:bg-slate-50"
                }`}
              >
                <p className={`font-medium text-sm ${selectedClientId === client.id ? activeItemText : "text-slate-800"}`}>
                  {client.name}
                </p>
                {client.assignee && (
                  <p className="text-xs text-slate-400 mt-0.5">{client.assignee}</p>
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* 하단 버튼 */}
      <div className="px-4 py-4 border-t border-slate-100 space-y-2">
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          + {entityLabel} 추가
        </button>
        <button
          onClick={handleLogout}
          className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors"
        >
          로그아웃
        </button>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <AddClientModal
            mode={mode}
            onClose={() => setShowAddModal(false)}
            onAdded={() => {
              setShowAddModal(false);
              fetchClients();
              onClientListChanged();
            }}
          />
        )}
      </AnimatePresence>
    </aside>
  );
}
