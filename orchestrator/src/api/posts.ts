import { apiFetch } from './client';

export interface Post {
  title: string;
  slug: string;
  excerpt?: string;
  coverImage?: string;
  body?: string;
  tags?: string;
  publishedAt?: string | null;
  status?: 'draft' | 'published' | string;
}

// Articles d'un site (brouillons + publiés) pour la gestion dans le CMS.
export function fetchPosts(siteSlug: string): Promise<{ docs: Post[] }> {
  return apiFetch(`/api/site-posts?site=${encodeURIComponent(siteSlug)}`);
}

// Crée ou met à jour un article (identifié par son slug au sein du site).
export function savePost(siteSlug: string, post: Post): Promise<{ success: boolean; slug: string }> {
  return apiFetch(`/api/site-posts?site=${encodeURIComponent(siteSlug)}`, {
    method: 'POST',
    body: JSON.stringify(post),
  });
}

export function deletePost(siteSlug: string, slug: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/site-posts?site=${encodeURIComponent(siteSlug)}&slug=${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
}
