'use client';
import type {RefObject} from 'react';
import type {Channel} from './use-catalogue';
import {channelBadge} from './poster-choice';

// The live channel lineup beside the player (Live TV): search, All / Favorites, category and the channel list. Its
// state lives in the player (player.tsx), which also zaps through it.

export type LineupProps = {
  channels: Channel[];
  filtered: Channel[];
  groups: string[];
  checking: boolean;
  signingOut: boolean;
  error: string;
  query: string;
  group: string;
  favoriteOnly: boolean;
  favorites: string[];
  limit: number;
  selectedId: string | undefined;
  searchInput: RefObject<HTMLInputElement | null>;
  channelList: RefObject<HTMLDivElement | null>;
  onRefresh: () => void;
  onQuery: (value: string) => void;
  onGroup: (value: string) => void;
  onFavoriteOnly: (value: boolean) => void;
  onMore: () => void;
  onReset: () => void;
  onChoose: (channel: Channel) => void;
  onFavorite: (id: string) => void;
};

export default function LiveLineup(props: LineupProps) {
  const {channels, filtered, groups, checking, signingOut, error, query, group, favoriteOnly, favorites, limit, selectedId, searchInput, channelList} = props;
  return <aside className="channel-panel" aria-label="Channel lineup" aria-busy={checking}>
    <div className="channel-panel-title"><h2>Your lineup</h2><button aria-label="Refresh channel list" disabled={checking || signingOut} onClick={props.onRefresh}>↻</button></div>
    <label className="search-label">Search channels<input ref={searchInput} aria-keyshortcuts="/" value={query} onChange={event => props.onQuery(event.target.value)} placeholder="A channel, a category…" type="search"/></label>
    <div className="channel-filters"><button aria-pressed={!favoriteOnly} onClick={() => props.onFavoriteOnly(false)}>All channels</button><button aria-pressed={favoriteOnly} onClick={() => props.onFavoriteOnly(true)}>★ Favorites</button></div>
    <label className="search-label">Category<select value={group} onChange={event => props.onGroup(event.target.value)}><option>All channels</option>{groups.map(item => <option key={item}>{item}</option>)}</select></label>
    <p className="channel-count">{filtered.length.toLocaleString()} {filtered.length === 1 ? 'channel' : 'channels'} {checking && '· refreshing…'}</p>
    {error && <p className="watch-error" role="alert">{error}</p>}
    <div className="channel-list" ref={channelList}>
      {filtered.slice(0, limit).map(channel => <div key={channel.id} data-channel={channel.id} className={'channel-row ' + (selectedId === channel.id ? 'selected' : '')}>
        <button className="channel-choice" data-focus-key={'channel:' + channel.id} disabled={!channel.token} aria-pressed={selectedId === channel.id} title={channel.reason || channel.name} onClick={() => props.onChoose(channel)}><span className="channel-icon" aria-hidden="true">{channelBadge(channel.name)}</span><span><strong>{channel.name}</strong><small>{channel.token ? channel.group : 'Stream unavailable'}</small></span>{selectedId === channel.id && <i className="status-dot" aria-hidden="true"/>}</button>
        <button className="favorite-button" aria-label={(favorites.includes(channel.id) ? 'Remove ' : 'Add ') + channel.name + (favorites.includes(channel.id) ? ' from favorites' : ' to favorites')} aria-pressed={favorites.includes(channel.id)} onClick={() => props.onFavorite(channel.id)}>{favorites.includes(channel.id) ? '★' : '☆'}</button>
      </div>)}
      {filtered.length === 0 && <div className="no-channels"><p>{channels.length === 0 ? 'Your channel list could not be loaded.' : favoriteOnly && !query && group === 'All channels' ? 'Star a channel to add it here.' : 'No channels match these filters.'}</p>{channels.length ? <button className="small-button" onClick={props.onReset}>Show all channels</button> : <button className="small-button" disabled={checking} onClick={props.onRefresh}>Try again</button>}</div>}
      {filtered.length > limit && <button className="load-more" onClick={props.onMore}>Show more channels ({Math.min(60, filtered.length - limit)})</button>}
    </div>
  </aside>;
}
