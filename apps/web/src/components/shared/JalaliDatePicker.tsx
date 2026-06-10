'use client';

/**
 * JalaliDatePicker — wraps react-multi-date-picker with Persian calendar
 *
 * Props:
 *   value    — ISO date string (Gregorian "YYYY-MM-DD") or ''
 *   onChange — called with ISO date string or '' when cleared
 */

import { useCallback } from 'react';
import DatePicker, { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import { cn } from '@/lib/utils';

interface JalaliDatePickerProps {
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function JalaliDatePicker({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ تولد',
  disabled,
  className,
}: JalaliDatePickerProps) {
  // Convert ISO gregorian → DateObject (jalali)
  const dateValue = value ? new DateObject({ date: new Date(value), calendar: persian }) : null;

  const handleChange = useCallback(
    (date: DateObject | null) => {
      if (!date) { onChange(''); return; }
      // Convert back to gregorian ISO
      const g = date.toDate();
      const iso = g.toISOString().split('T')[0];
      onChange(iso);
    },
    [onChange],
  );

  return (
    <DatePicker
      value={dateValue}
      onChange={handleChange}
      calendar={persian}
      locale={persian_fa}
      disabled={disabled}
      placeholder={placeholder}
      maxDate={new DateObject({ calendar: persian })} // today at most
      inputClass={cn(
        'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5',
        'text-sm text-gray-800 placeholder:text-gray-400',
        'focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 focus:bg-white',
        'transition-all cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
      containerStyle={{ width: '100%' }}
      calendarPosition="bottom-right"
      fixMainPosition
    />
  );
}
