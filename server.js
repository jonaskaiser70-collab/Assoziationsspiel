// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

// ====== Game State pro Room ======
/*
rooms[roomId] = {
  prompt: string|null,
  revealed: boolean,
  roundResolved: boolean, // richtig/falsch schon entschieden?
  globalScore: number,
  players: Map<socketId, { id, name, answer, ready }>
}
*/
const rooms = Object.create(null);

// simple Wortliste (später gern ersetzen/erweitern)
const WORDS = [
  // Essen & Trinken
  "Eissorte", "Brotaufstrich", "Obst", "Gemüse", "Käse", "Getränk",
  "Cocktail", "Pizza-Belag", "Süßigkeit", "Snack", "Fast-Food-Gericht",
  "Teesorte", "Nudelgericht", "Suppenart", "Gewürz",
  
  // Backen & Kochen
  "Gebäck", "Kuchen", "Plätzchen", "Brotart", "Frühstücksgericht",
  "Soße", "Salatsorte",
  
  // Wohnen & Haus
  "Teil eines Hauses", "Raum in einer Wohnung", "Möbelstück", "Haushaltsgerät",
  "Deko-Objekt", "Bodenbelag", "Wandfarbe", "Haustier",
  
  // Fahrzeuge & Technik
  "Automarke", "Automodell", "Motorradmarke", "Fahrradtyp", "Flugzeugtyp",
  "Computerspiel", "Smartphone-Marke", "Konsolenspiel", "App",
  
  // Medien & Unterhaltung
  "Youtuber/Streamer", "Filmgenre", "Seriencharakter", "Musikinstrument",
  "Musikgenre", "Sänger/in", "Bandname", "Buchreihe", "Comicfigur",
  "Superheld", "Cartoonfigur", "Serie", "Disney-Figur", 

  // Schule & Bildung
  "Schulfach", "Beruf", "Mathematikbegriff",
    "Musikrichtung", "Geschichtsereignis", 

  
  // Freizeit & Reisen
  "Sportart", "Brettspiel", "Reiseziel", "Stadt", "Land",
  "Insel", "Tier", "Hobby",  "Festival",
  "Jahreszeit", "Feiertag", 
  
  // Sonstiges & Kreativ
  "Beruf", "Schulfach", "Kleidungsstück", "Schmuckstück",
  "Farbe", "Blume", "Baum", "Wetterphänomen"
];

const nextWord = () => WORDS[Math.floor(Math.random()*WORDS.length)];

/* ---------- Helpers ---------- */
function ensureRoom(roomId){
  const R = rooms[roomId] ?? (rooms[roomId] = {
    prompt: nextWord(),
    revealed: false,
    roundResolved: false,
    globalScore: 0,
    players: new Map()
  });
  return R;
}
function dumpState(R, revealAnswers = false){
  return {
    prompt: R.prompt,
    revealed: R.revealed,
    roundResolved: R.roundResolved,
    globalScore: R.globalScore,
    players: [...R.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready
    })),
    answers: revealAnswers
      ? [...R.players.values()].map(p => ({ id: p.id, name: p.name, answer: p.answer }))
      : null
  };
}
function allReady(R){ 
  const list = [...R.players.values()];
  return list.length >= 2 && list.every(p => p.ready && p.answer.trim().length>0);
}

/* ---------- Socket.IO ---------- */
io.on("connection", (socket)=>{
  let roomId = null;
  let displayName = null;

  socket.on("join", ({ room, name })=>{
    roomId = (room || "DEMO").toUpperCase();
    displayName = (name || `Player-${socket.id.slice(0,5)}`).trim();
    const R = ensureRoom(roomId);

    socket.join(roomId);
    R.players.set(socket.id, { id: socket.id, name: displayName, answer: "", ready: false });

    io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, R.revealed) });
  });

  socket.on("player:updateAnswer", ({ answer })=>{
    if(!roomId) return;
    const R = ensureRoom(roomId);
    const P = R.players.get(socket.id);
    if(!P || R.revealed) return; // nach Reveal keine Änderung
    P.answer = (answer || "").toString().slice(0,200);
    io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, R.revealed) });
  });

  socket.on("player:pressReveal", ()=>{
    if(!roomId) return;
    const R = ensureRoom(roomId);
    const P = R.players.get(socket.id);
    if(!P || R.revealed) return;
    if(!P.answer || !P.answer.trim()) return; // braucht Antwort
    P.ready = true;

    if(allReady(R)){
      R.revealed = true;
      io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, true) });
    } else {
      io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, false) });
    }
  });

  socket.on("round:mark", ({ result })=>{
    if(!roomId) return;
    const R = ensureRoom(roomId);
    if(!R.revealed || R.roundResolved) return;
    if(result === "richtig"){
      R.globalScore += 1;
    }
    R.roundResolved = true;
    io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, true) });
  });

  socket.on("round:next", ()=>{
    if(!roomId) return;
    const R = ensureRoom(roomId);
    if(!(R.revealed && R.roundResolved)) return; // erst nach Entscheidung
    R.prompt = nextWord();
    R.revealed = false;
    R.roundResolved = false;
    for(const p of R.players.values()){
      p.answer = "";
      p.ready = false;
    }
    io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, false) });
  });

  socket.on("disconnect", ()=>{
    if(!roomId) return;
    const R = rooms[roomId];
    if(!R) return;
    R.players.delete(socket.id);

    if(R.players.size === 0){
      delete rooms[roomId];
    } else {
      io.to(roomId).emit("state:sync", { room: roomId, state: dumpState(R, R.revealed) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log("Server läuft auf http://localhost:"+PORT));
