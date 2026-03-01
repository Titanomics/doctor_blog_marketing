"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface AddClientModalProps {
  mode: "blog" | "cafe";
  onClose: () => void;
  onAdded: () => void;
}

export default function AddClientModal({ mode, onClose, onAdded }: AddClientModalProps) {
  const isBlog = mode === "blog";
  const [form, setForm] = useState({ name: "", assignee: "", url: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body = isBlog
        ? { name: form.name, assignee: form.assignee, blog_url: form.url }
        : { name: form.name, assignee: form.assignee };

      const endpoint = isBlog ? "/api/clients" : "/api/cafe/clients";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "오류가 발생했습니다.");
      } else {
        onAdded();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-bold text-slate-800 mb-5">
          {isBlog ? "병원 추가" : "브랜드 추가"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              {isBlog ? "병원명" : "브랜드명"}
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={isBlog ? "예: 강남 리쥬란의원" : "예: 솔직한알, PDRN치약"}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-none text-slate-800 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">
              담당자
            </label>
            <input
              type="text"
              required={isBlog}
              value={form.assignee}
              onChange={(e) => setForm({ ...form, assignee: e.target.value })}
              placeholder="예: 김경록"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-none text-slate-800 text-sm"
            />
          </div>
          {isBlog && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1.5">
                블로그 주소
              </label>
              <input
                type="text"
                required
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="예: blog.naver.com/myhospital"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-emerald-500 outline-none text-slate-800 text-sm"
              />
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 text-white text-sm font-medium transition-colors"
            >
              {loading ? "추가 중..." : "추가하기"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
