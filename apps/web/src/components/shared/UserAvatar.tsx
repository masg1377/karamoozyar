'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useSignedAvatarUrl } from '@/hooks/useSignedAvatarUrl';

interface UserAvatarProps {
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
};

export function UserAvatar({ firstName, lastName, avatarUrl, size = 'md', className }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const resolvedUrl = useSignedAvatarUrl(avatarUrl);
  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`;

  if (resolvedUrl && !imgError) {
    return (
      <img
        src={resolvedUrl}
        alt={`${firstName} ${lastName}`}
        className={cn('rounded-full object-cover flex-shrink-0', sizeMap[size], className)}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full bg-primary-100 text-primary-700 font-semibold flex items-center justify-center flex-shrink-0',
        sizeMap[size],
        className,
      )}
    >
      {initials}
    </div>
  );
}
