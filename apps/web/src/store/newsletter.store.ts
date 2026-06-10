'use client';

import { create } from 'zustand';
import type { NewsletterPostDto } from '@karamooziyar/shared';

interface NewsletterState {
  posts: NewsletterPostDto[];
  nextCursor: string | null;
  hasMore: boolean;
  setPosts: (posts: NewsletterPostDto[], nextCursor: string | null) => void;
  appendPosts: (posts: NewsletterPostDto[], nextCursor: string | null) => void;
  addPost: (post: NewsletterPostDto) => void;
  updatePost: (postId: string, patch: Partial<NewsletterPostDto>) => void;
  removePost: (postId: string) => void;
}

export const useNewsletterStore = create<NewsletterState>((set) => ({
  posts: [],
  nextCursor: null,
  hasMore: false,

  setPosts: (posts, nextCursor) =>
    set({ posts, nextCursor, hasMore: nextCursor !== null }),

  appendPosts: (posts, nextCursor) =>
    set((state) => ({
      posts: [...state.posts, ...posts],
      nextCursor,
      hasMore: nextCursor !== null,
    })),

  addPost: (post) => set((state) => ({ posts: [post, ...state.posts] })),

  updatePost: (postId, patch) =>
    set((state) => ({
      posts: state.posts.map((p) => (p.id === postId ? { ...p, ...patch } : p)),
    })),

  removePost: (postId) =>
    set((state) => ({ posts: state.posts.filter((p) => p.id !== postId) })),
}));
