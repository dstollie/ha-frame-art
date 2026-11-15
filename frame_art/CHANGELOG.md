# Changelog

## 0.1.1

- Fix: pairing with a Frame that accepts FrameArt without handing out a token (2022 LS03B) now counts as paired. Before, the app kept showing "niet gekoppeld".
- Pairing attempts and their outcome are logged.

## 0.1.0

- First release: browse open-access paintings from The Met, the Rijksmuseum and the Cleveland Museum of Art, and send one to a Samsung The Frame with one tap (light, dark, blur or fill passe-partout).
- Pair each TV from Instellingen; tokens stay in `/data/tokens`.
- Favourites, history, a rotation category per TV, and MQTT entities (button, select, sensor, image) for HA and Node-RED.
