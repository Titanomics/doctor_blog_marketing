"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ModeSelectProps {
  onSelect: (mode: "blog" | "cafe" | "reporter") => void;
}

export default function ModeSelect({ onSelect }: ModeSelectProps) {
  const [showProductSub, setShowProductSub] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">기린컴퍼니 순위 대시보드</h1>
        <p className="text-gray-500 mb-10">추적할 서비스를 선택하세요</p>
        <div className="flex gap-6 justify-center">
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

          {/* 제품 마케팅 */}
          <div className="relative w-56 h-56">
            <AnimatePresence mode="wait">
              {!showProductSub ? (
                <motion.button
                  key="product-main"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowProductSub(true)}
                  className="w-full h-full bg-white rounded-2xl shadow-lg border-2 border-transparent hover:border-green-500 flex flex-col items-center justify-center gap-4 transition-colors"
                >
                  <span className="text-5xl">📦</span>
                  <span className="text-lg font-semibold">제품 마케팅</span>
                  <span className="text-sm text-gray-400">카페/블로그 순위 추적</span>
                </motion.button>
              ) : (
                <motion.div
                  key="product-sub"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full h-full bg-white rounded-2xl shadow-lg border-2 border-green-300 flex flex-col items-center justify-center gap-3 p-4"
                >
                  <span className="text-sm font-semibold text-gray-600 mb-1">제품 마케팅</span>
                  <button
                    onClick={() => onSelect("cafe")}
                    className="w-full py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium transition-colors"
                  >
                    ☕ 카페 순위 추적
                  </button>
                  <button
                    onClick={() => onSelect("reporter")}
                    className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
                  >
                    📝 블로그기자단 순위 추적
                  </button>
                  <button
                    onClick={() => setShowProductSub(false)}
                    className="text-xs text-gray-400 hover:text-gray-600 mt-1"
                  >
                    ← 뒤로
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
