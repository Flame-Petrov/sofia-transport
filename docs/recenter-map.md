# Recenter map on Sofia

The corner-brackets button above the location control returns the map to central Sofia at the startup zoom (13). It releases vehicle and location follow and uses the active camera. The location control still centers on the rider.

The control and overview coordinates live in `src/shared/map/base-map.js`, with styling in `src/shared/ui/theme.css`. To verify, pan away, zoom in and activate **Recenter map on Sofia**. Check that the center returns to 42.6977, 23.3219 at zoom 13. Repeat in tilted view to check the 3D camera.
