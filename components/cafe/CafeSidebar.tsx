"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CafeClient } from "@/lib/types";
import AddCafeClientModal from "@/components/cafe/AddCafeClientModal";

interface CafeSidebarProps {
  selectedClientId: string | null;
  onClientSelect: (client: CafeClient) => void;
  refreshTrigger: number;
  onClientListChanged: () => void;
}

export default function CafeSidebar({
  selectedClientId,
  onClientSelect,
  refreshTrigger,
  onClientListChanged,
}: CafeSidebarProps) {
  const [clients, setClients] = useState<CafeClient[]>([]);
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [myName, setMyName] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cafe/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
      {/* 브랜드 헤더 */}
      <div className="px-5 py-5 border-b border-slate-100">
        <h1 className="text-lg font-bold text-slate-800">기린컴퍼니</h1>
        <p className="text-xs text-slate-400 mt-0.5">카페 순위 대시보드</p>
      </div>

      {/* 필터 영역 */}
      <div className="px-4 pt-4 pb-2 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => setAssigneeFilter("all")}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              assigneeFilter === "all"
                ? "bg-violet-500 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            전체
          </button>
          <button
            onClick={() => setAssigneeFilter("mine")}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              assigneeFilter === "mine"
                ? "bg-violet-500 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            내 브랜드
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-violet-400 outline-none text-slate-700 placeholder:text-slate-400"
            />
          )}
        </AnimatePresence>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="브랜드 / 담당자 검색..."
          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-violet-400 outline-none text-slate-700 placeholder:text-slate-400"
        />
      </div>

      {/* 브랜드 리스트 */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            불러오는 중...
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            {search ? "검색 결과 없음" : "등록된 브랜드 없음"}
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
                    ? "bg-violet-50 border border-violet-200"
                    : "hover:bg-slate-50"
                }`}
              >
                <p
                  className={`font-medium text-sm ${
                    selectedClientId === client.id
                      ? "text-violet-700"
                      : "text-slate-800"
                  }`}
                >
                  {client.name}
                </p>
                {client.assignee && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {client.assignee}
                  </p>
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
          + 브랜드 추가
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
          <AddCafeClientModal
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
