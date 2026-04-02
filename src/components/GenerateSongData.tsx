import React, { useState } from 'react';
import { fetchSpotifyTracks } from '../lib/spotify';
import type { SongData } from '../types';

const GenerateSongData: React.FC = () => {
  const [ids, setIds] = useState('');
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [songData, setSongData] = useState<SongData[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setError(null);
    setSongData([]);
    setProgress(0);
    setDownloading(true);
    const idList = ids.split(/\s|,|\n/).filter(Boolean);
    setTotal(idList.length);
    const results: SongData[] = [];
    for (let i = 0; i < idList.length; i++) {
      try {
        const data = await fetchSpotifyTracks([idList[i]]);
        if (data && data.length > 0) {
          results.push(data[0]);
        }
      } catch (e) {
        setError(`Error fetching song with ID: ${idList[i]}`);
      }
      setProgress(i + 1);
    }
    setSongData(results);
    setDownloading(false);
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(songData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'song-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h2>Generate Song Data File</h2>
      <textarea
        rows={8}
        style={{ width: '100%' }}
        placeholder="Paste Spotify song IDs, separated by spaces, commas, or newlines"
        value={ids}
        onChange={e => setIds(e.target.value)}
        disabled={downloading}
      />
      <button onClick={handleGenerate} disabled={downloading || !ids.trim()}>
        Generate
      </button>
      {downloading && (
        <div style={{ marginTop: 16 }}>
          <progress value={progress} max={total} style={{ width: '100%' }} />
          <div>{progress} / {total} songs processed</div>
        </div>
      )}
      {songData.length > 0 && !downloading && (
        <div style={{ marginTop: 16 }}>
          <div>{songData.length} songs in file</div>
          <button onClick={handleDownload}>Download song-data.json</button>
        </div>
      )}
      {error && <div style={{ color: 'red', marginTop: 16 }}>{error}</div>}
    </div>
  );
};

export default GenerateSongData;
