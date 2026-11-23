-- Free plan allows up to 50 MB per file; use all of it for show playlist tracks.
update storage.buckets set file_size_limit = 52428800 where id = 'playlists';
