// Turning browse index entries into poster cards (shared by Home, Discover, Library and Search).
import {libraryProgress, progressFraction, type Catalog, type IndexedTitle, type Library, type TitleRef} from '../../lib/browse';
import type {CardItem} from './poster';
import {posterChoices, type PosterSources} from './poster-choice';

export function cardItem(title: IndexedTitle, library: Library, posters: PosterSources): CardItem {
  const progress = libraryProgress(library, title.key);
  return {
    title, srcs: posterChoices(title, posters), favorite: library.fav.includes(title.key), progress: progressFraction(progress),
    subtitle: progress?.l ? (progress.nx ? 'Next: ' : '') + progress.l : undefined,
  };
}

export function cardsFor(refs: TitleRef[], catalog: Catalog, library: Library, posters: PosterSources) {
  return refs.map(ref => cardItem(catalog[ref.type].items[ref.idx], library, posters));
}

/** A title in the catalogue by its Library key, or null. */
export function findTitle(catalog: Catalog | null, key: string): IndexedTitle | null {
  if (!catalog) return null;
  const section = key.startsWith('s') ? catalog.series : catalog.movies;
  const index = section.byKey.get(key);
  return index === undefined ? null : section.items[index];
}

export const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
