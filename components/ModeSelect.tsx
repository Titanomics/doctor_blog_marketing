"use client";

import { motion } from "framer-motion";

interface ModeSelectProps {
  onSelect: (mode: "blog" | "cafe") => void;
}

export default function ModeSelect({ onSelect }: ModeSelectProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">기린컴퍼니 순위 대시보드</h1>
        <p className="text-gray-500 mb-10">추적할 서비스를 선택하세요</p>
        <div className="flex gap-6">
          {/* 병원 블로그 */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect("blog")}
            className="w-56 h-56 bg-white rounded-2xl shadow-lg border-2 border-transparent hover:border-blue-500 flex flex-col items-center justify-center gap-4 transition-colors"
          >
            <span className="text-5xl">🏥</span>
            <span className="text-lg font-semibold">병원 마케팅</span>
            <span className="text-sm text-gray-400">블로그 순위 추적</span>
          </motion.button>

          {/* 제품 카페 */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect("cafe")}
            className="w-56 h-56 bg-white rounded-2xl shadow-lg border-2 border-transparent hover:border-green-500 flex flex-col items-center justify-center gap-4 transition-colors"
          >
            <span className="text-5xl">📦</span>
            <span className="text-lg font-semibold">제품 마케팅</span>
            <span className="text-sm text-gray-400">카페 순위 추적</span>
          </motion.button>
        </div>
      </div>
    </div>
  );
}
