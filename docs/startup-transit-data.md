# Startup transit data and frame timing

The map starts loading live vehicle positions while the static GTFS archive supplies line names, stops, route geometry and the daily timetable. The archive can come from the network or the existing IndexedDB cache.

- `src/shared/transit/static-feed.js` loads the archive and parses route, trip and stop tables in a dedicated worker. The page attaches the resulting stop records to its spatial index.
- `src/features/vehicles/route-line.js` groups shape points by ID and sorts them by the GTFS sequence in a worker. It transfers one numeric coordinate buffer to the page. A route expands into its original coordinate arrays on first access. Concurrent requests share one load.
- `src/shared/transit/timetable.js` builds a missing service-day index in a worker. The page still validates, reads and saves the same IndexedDB format. The index includes overnight trips, stop order and walking transfers.
- The standalone page embeds the worker routines and each worker imports the same pinned JSZip URL as the page. Each job releases its worker and Blob URL on completion or failure. If worker startup, import or execution fails, the page runs the same data parser locally.

To verify, run the numbered release with a fresh browser profile. Check a live vehicle card, the route and next stop, then check the service-day index in diagnostics. Reload with the cache populated. For a timing comparison, use the same viewport and CPU settings for both builds. Hold the static archive until the vector map has loaded, then measure frame intervals while releasing the archive. Measure ordinary cold startup separately because it includes WebGL initialization and tile work.
