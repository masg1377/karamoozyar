'use client';

/** جداکننده‌ی تاریخ بین پیام‌های روزهای مختلف (به سبک تلگرام) */
export function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex justify-center my-2 select-none">
      <span className="px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm text-[11px] font-medium text-gray-500 shadow-sm">
        {label}
      </span>
    </div>
  );
}

/** برچسب تاریخ شناور بالای چت که هنگام اسکرول ظاهر و سپس محو می‌شود */
export function StickyDate({ label, visible }: { label: string; visible: boolean }) {
  return (
    <div
      style={{ position: 'sticky', top: 8, height: 0, zIndex: 20, pointerEvents: 'none' }}
      className="flex justify-center overflow-visible"
    >
      <span
        className="px-3 py-1 rounded-full bg-primary-600/90 backdrop-blur-sm text-[11px] font-semibold text-white shadow-md"
        style={{ opacity: visible && label ? 1 : 0, transition: 'opacity 0.25s ease', transform: 'translateY(0)' }}
      >
        {label}
      </span>
    </div>
  );
}
