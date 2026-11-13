import { world, system } from "@minecraft/server";

// Constantes de tiempo (en ticks: 20 ticks = 1 segundo, 24000 ticks = 1 día de Minecraft)
const TICKS_PER_DAY = 24000;
const ENTITY_ID = "horror:elitsano";

// Fases de la historia:
// 0 = Tranquilo en el mundo (esperando evento de unión falsa)
// 1 = Ya salió "elitsano se unió al juego" (esperando al día siguiente para tocar la puerta)
// 2 = Día siguiente: tocando 3 veces lentamente la puerta
// 3 = Después de la puerta: aparición de acecho a lo lejos (esperando que el jugador se acerque)
// 4 = Ceguera II activa y persecución furiosa hasta la muerte del jugador
// 5 = Post-muerte: acecho simultáneo periódico desde la distancia para siempre

function getWorldPhase() {
    const val = world.getDynamicProperty("elitsano:phase");
    return typeof val === "number" ? val : 0;
}

function setWorldPhase(phase) {
    world.setDynamicProperty("elitsano:phase", phase);
}

function getJoinDay() {
    const val = world.getDynamicProperty("elitsano:joinDay");
    return typeof val === "number" ? val : -1;
}

function setJoinDay(day) {
    world.setDynamicProperty("elitsano:joinDay", day);
}

function getCurrentDay() {
    return Math.floor(world.getAbsoluteTime() / TICKS_PER_DAY);
}

// Busca una posición segura en el suelo a cierta distancia del jugador
function findSurfaceSpawnLocation(player, minDist, maxDist, behindPlayer = false) {
    const dim = player.dimension;
    const pLoc = player.location;
    const viewDir = player.getViewDirection();

    for (let attempt = 0; attempt < 20; attempt++) {
        let angle;
        if (behindPlayer) {
            // Aparecer detrás o en los flancos del jugador
            const baseAngle = Math.atan2(-viewDir.z, -viewDir.x);
            angle = baseAngle + (Math.random() - 0.5) * 1.4;
        } else {
            // Aparecer preferiblemente frente o en ángulo visible a lo lejos
            const baseAngle = Math.atan2(viewDir.z, viewDir.x);
            angle = baseAngle + (Math.random() - 0.5) * 1.8;
        }

        const dist = minDist + Math.random() * (maxDist - minDist);
        const tx = Math.floor(pLoc.x + Math.cos(angle) * dist);
        const tz = Math.floor(pLoc.z + Math.sin(angle) * dist);

        // Buscar suelo sólido cerca de la altura Y del jugador
        for (let dy = 8; dy >= -8; dy--) {
            const ty = Math.floor(pLoc.y + dy);
            try {
                const blockBelow = dim.getBlock({ x: tx, y: ty - 1, z: tz });
                const blockFeet = dim.getBlock({ x: tx, y: ty, z: tz });
                const blockHead = dim.getBlock({ x: tx, y: ty + 1, z: tz });

                if (
                    blockBelow && !blockBelow.isAir && !blockBelow.isLiquid &&
                    blockFeet && blockFeet.isAir &&
                    blockHead && blockHead.isAir
                ) {
                    return { x: tx + 0.5, y: ty, z: tz + 0.5 };
                }
            } catch (e) {
                // Chunk no cargado
            }
        }
    }
    return null;
}

// Busca una puerta cerca del jugador para el evento de los 3 golpes
function findNearbyDoor(player, radius = 14) {
    const dim = player.dimension;
    const pLoc = player.location;
    const px = Math.floor(pLoc.x);
    const py = Math.floor(pLoc.y);
    const pz = Math.floor(pLoc.z);

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -3; dy <= 4; dy++) {
            for (let dz = -radius; dz <= radius; dz++) {
                try {
                    const block = dim.getBlock({ x: px + dx, y: py + dy, z: pz + dz });
                    if (block && block.typeId.includes("door") && !block.typeId.includes("trapdoor")) {
                        return { x: px + dx + 0.5, y: py + dy, z: pz + dz + 0.5 };
                    }
                } catch (e) {}
            }
        }
    }
    return null;
}

// Elimina cualquier instancia activa de Elitsano
function despawnAllElitsano() {
    for (const dimId of ["overworld", "nether", "the_end"]) {
        try {
            const dim = world.getDimension(dimId);
            const entities = dim.getEntities({ type: ENTITY_ID });
            for (const ent of entities) {
                ent.remove();
            }
        } catch (e) {}
    }
}

// Reproduce sonidos tensos de ambientación
function playTenseAmbience(player, type = "appear") {
    try {
        if (type === "appear") {
            player.playSound("ambient.cave", { volume: 1.0, pitch: 0.55 });
            player.playSound("mob.endermen.stare", { volume: 0.7, pitch: 0.5 });
        } else if (type === "vanish") {
            player.playSound("mob.endermen.portal", { volume: 1.0, pitch: 0.6 });
            player.playSound("ambient.cave", { volume: 1.0, pitch: 0.45 });
        } else if (type === "chase") {
            player.playSound("mob.warden.heartbeat", { volume: 1.0, pitch: 0.85 });
            player.playSound("mob.endermen.scream", { volume: 0.9, pitch: 0.55 });
        } else if (type === "knock") {
            // Sonido de golpe lento en puerta de madera
            player.playSound("knock.wooden_door", { volume: 1.0, pitch: 0.75 });
        }
    } catch (e) {}
}

// Genera a Elitsano en modo acecho (quieto mirando al jugador)
function spawnStalkerElitsano(player, minDist = 28, maxDist = 45) {
    const dim = player.dimension;
    if (dim.id !== "minecraft:overworld") return null;

    const existing = dim.getEntities({ type: ENTITY_ID });
    if (existing.length > 0) return existing[0];

    const loc = findSurfaceSpawnLocation(player, minDist, maxDist, false);
    if (!loc) return null;

    const elitsano = dim.spawnEntity(ENTITY_ID, loc);
    elitsano.nameTag = "elitsano";
    elitsano.triggerEvent("elitsano:become_stalker");
    playTenseAmbience(player, "appear");
    return elitsano;
}

// Ejecuta la secuencia de 3 golpes lentos en la puerta
let knockInProgress = false;
function triggerDoorKnockSequence(player, doorLoc) {
    if (knockInProgress) return;
    knockInProgress = true;

    const soundPos = doorLoc || {
        x: player.location.x + (Math.random() > 0.5 ? 5 : -5),
        y: player.location.y,
        z: player.location.z + (Math.random() > 0.5 ? 5 : -5)
    };

    // Golpe 1
    system.runTimeout(() => {
        try {
            player.dimension.playSound("knock.wooden_door", soundPos, { volume: 1.0, pitch: 0.72 });
            player.playSound("ambient.cave", { volume: 0.6, pitch: 0.6 });
        } catch (e) {}
    }, 10);

    // Golpe 2 (lento: 1.6 segundos después)
    system.runTimeout(() => {
        try {
            player.dimension.playSound("knock.wooden_door", soundPos, { volume: 1.0, pitch: 0.70 });
        } catch (e) {}
    }, 42);

    // Golpe 3 (lento: 3.2 segundos después)
    system.runTimeout(() => {
        try {
            player.dimension.playSound("knock.wooden_door", soundPos, { volume: 1.0, pitch: 0.68 });
        } catch (e) {}
    }, 74);

    // Pasar a Fase 3 después de que el jugador revise la puerta
    system.runTimeout(() => {
        setWorldPhase(3);
        knockInProgress = false;
        world.setDynamicProperty("elitsano:phase3ReadyTick", system.currentTick + 400); // ~20s después
    }, 140);
}

// Disparador de unión falsa cuando el jugador tala madera o pica piedra
let blocksBrokenCount = 0;
world.afterEvents.playerBreakBlock.subscribe((ev) => {
    const phase = getWorldPhase();
    if (phase !== 0) return;

    const blockId = ev.brokenBlockPermutation.type.id;
    if (blockId.includes("log") || blockId.includes("stone") || blockId.includes("cobblestone") || blockId.includes("dirt")) {
        blocksBrokenCount++;
        // Después de picar unos bloques tranquilos (ej. 12 bloques) o pasar 2 minutos
        if (blocksBrokenCount >= 12) {
            triggerFakeJoin(ev.player);
        }
    }
});

function triggerFakeJoin(player) {
    if (getWorldPhase() !== 0) return;
    setWorldPhase(1);
    setJoinDay(getCurrentDay());

    // Mensaje amarillo idéntico al de Minecraft Bedrock cuando alguien entra al mundo
    world.sendMessage("§eelitsano se unió al juego");
    try {
        player.playSound("ambient.cave", { volume: 0.85, pitch: 0.65 });
    } catch (e) {}
}

// Al reaparecer tras morir por Elitsano: quitar ceguera, despawnear y pasar a acecho permanente
world.afterEvents.playerSpawn.subscribe((ev) => {
    if (!ev.initialSpawn) {
        const player = ev.player;
        const phase = getWorldPhase();

        try {
            player.removeEffect("blindness");
            player.removeEffect("darkness");
        } catch (e) {}

        if (phase === 4) {
            despawnAllElitsano();
            setWorldPhase(5);
            world.setDynamicProperty("elitsano:nextStalkTick", system.currentTick + 600);
        }
    }
});

// Comando rápido /scriptevent elitsano:next para adelantar fases si quieres probarlo al instante
system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id === "elitsano:next") {
        const players = world.getAllPlayers();
        if (players.length === 0) return;
        const p = players[0];
        const phase = getWorldPhase();

        if (phase === 0) {
            triggerFakeJoin(p);
        } else if (phase === 1) {
            setWorldPhase(2);
            const door = findNearbyDoor(p, 16);
            triggerDoorKnockSequence(p, door);
        } else if (phase === 2 || phase === 3) {
            setWorldPhase(3);
            world.setDynamicProperty("elitsano:phase3ReadyTick", system.currentTick);
            spawnStalkerElitsano(p, 24, 34);
        } else if (phase === 5) {
            spawnStalkerElitsano(p, 28, 42);
        }
    } else if (ev.id === "elitsano:reset") {
        despawnAllElitsano();
        setWorldPhase(0);
        blocksBrokenCount = 0;
        world.sendMessage("§7[Elitsano] Ciclo reiniciado a Fase 0.");
    }
});

// Bucle principal cada 10 ticks (0.5 segundos)
let chaseStarted = false;
let heartbeatCounter = 0;

system.runInterval(() => {
    const players = world.getAllPlayers();
    if (players.length === 0) return;
    const player = players[0];
    const phase = getWorldPhase();
    const currentDay = getCurrentDay();
    const currentTick = system.currentTick;

    // FASE 0: Si lleva 2.5 minutos (3000 ticks) en el mundo sin picar 12 bloques, igual ocurre la unión falsa
    if (phase === 0 && currentTick > 3000) {
        triggerFakeJoin(player);
        return;
    }

    // FASE 1: Esperando al día siguiente (cuando cambie el día de Minecraft)
    if (phase === 1) {
        const joinDay = getJoinDay();
        if (currentDay > joinDay) {
            const doorLoc = findNearbyDoor(player, 14);
            // Si está en casa cerca de una puerta (o avanza el día), toca 3 veces
            if (doorLoc || (world.getAbsoluteTime() % TICKS_PER_DAY) > 2000) {
                setWorldPhase(2);
                triggerDoorKnockSequence(player, doorLoc);
            }
        }
        return;
    }

    // FASE 3: Aparece a lo lejos tras salir de casa; cuando el jugador se acerca mucho -> Ceguera II + Persecución
    if (phase === 3) {
        const readyTick = world.getDynamicProperty("elitsano:phase3ReadyTick") || 0;
        if (currentTick < readyTick) return;

        const dim = player.dimension;
        let elitsanos = dim.getEntities({ type: ENTITY_ID });

        if (elitsanos.length === 0) {
            spawnStalkerElitsano(player, 26, 38);
            return;
        }

        const elitsano = elitsanos[0];
        const dx = elitsano.location.x - player.location.x;
        const dy = elitsano.location.y - player.location.y;
        const dz = elitsano.location.z - player.location.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Sonido tenso leve mientras te observa desde lejos
        if (currentTick % 80 === 0) {
            try {
                player.playSound("ambient.cave", { volume: 0.45, pitch: 0.5 });
            } catch (e) {}
        }

        // Si el jugador se acerca a menos de 11 bloques para ver quién es:
        if (dist <= 11.0) {
            // Desaparece con partículas y sonido
            try {
                dim.spawnParticle("minecraft:large_explosion", {
                    x: elitsano.location.x,
                    y: elitsano.location.y + 1.0,
                    z: elitsano.location.z
                });
            } catch (e) {}

            elitsano.remove();
            playTenseAmbience(player, "vanish");

            // Aplica Ceguera II (amplifier: 1 = nivel II en Bedrock)
            player.addEffect("blindness", 2400, { amplifier: 1, showParticles: false });

            setWorldPhase(4);
            chaseStarted = false;

            // 2.5 segundos después, en medio de la ceguera, aparece furioso persiguiendo rápido
            system.runTimeout(() => {
                if (getWorldPhase() !== 4) return;
                const chaseLoc = findSurfaceSpawnLocation(player, 9, 14, true) || {
                    x: player.location.x - 6,
                    y: player.location.y,
                    z: player.location.z - 6
                };

                const hunter = player.dimension.spawnEntity(ENTITY_ID, chaseLoc);
                hunter.nameTag = "elitsano";
                hunter.triggerEvent("elitsano:become_enraged");
                playTenseAmbience(player, "chase");
                chaseStarted = true;
            }, 50);
        }
        return;
    }

    // FASE 4: Persecución furiosa con ceguera hasta que el jugador muera
    if (phase === 4 && chaseStarted) {
        // Mantener Ceguera II activa mientras dure la caza
        try {
            player.addEffect("blindness", 100, { amplifier: 1, showParticles: false });
        } catch (e) {}

        heartbeatCounter++;
        if (heartbeatCounter % 4 === 0) {
            try {
                player.playSound("mob.warden.heartbeat", { volume: 1.0, pitch: 1.0 });
            } catch (e) {}
        }

        // Asegurar que siempre haya un Elitsano furioso cerca si se quedó atascado lejos
        const dim = player.dimension;
        const hunters = dim.getEntities({ type: ENTITY_ID });
        if (hunters.length === 0) {
            const loc = findSurfaceSpawnLocation(player, 8, 13, true);
            if (loc) {
                const h = dim.spawnEntity(ENTITY_ID, loc);
                h.nameTag = "elitsano";
                h.triggerEvent("elitsano:become_enraged");
            }
        } else {
            const h = hunters[0];
            const dist = Math.hypot(h.location.x - player.location.x, h.location.z - player.location.z);
            if (dist > 32) {
                const nearLoc = findSurfaceSpawnLocation(player, 8, 12, true);
                if (nearLoc) h.teleport(nearLoc);
            }
        }
        return;
    }

    // FASE 5: Post-muerte -> Acecho simultáneo desde lo lejos periódicamente
    if (phase === 5) {
        const dim = player.dimension;
        const stalkers = dim.getEntities({ type: ENTITY_ID });
        const nextStalk = world.getDynamicProperty("elitsano:nextStalkTick") || 0;

        if (stalkers.length === 0) {
            if (currentTick >= nextStalk) {
                const spawned = spawnStalkerElitsano(player, 30, 48);
                if (spawned) {
                    // Se queda acechando entre 20 y 40 segundos
                    world.setDynamicProperty("elitsano:despawnStalkTick", currentTick + 500 + Math.floor(Math.random() * 300));
                } else {
                    world.setDynamicProperty("elitsano:nextStalkTick", currentTick + 200);
                }
            }
        } else {
            const s = stalkers[0];
            const dist = Math.hypot(s.location.x - player.location.x, s.location.z - player.location.z);
            const despawnTick = world.getDynamicProperty("elitsano:despawnStalkTick") || 0;

            // Si te acercas mucho mientras te acecha o se acaba su tiempo, desaparece entre humo y sonido
            if (dist < 13 || currentTick >= despawnTick) {
                try {
                    dim.spawnParticle("minecraft:large_explosion", {
                        x: s.location.x,
                        y: s.location.y + 1.0,
                        z: s.location.z
                    });
                    player.playSound("ambient.cave", { volume: 0.7, pitch: 0.5 });
                } catch (e) {}
                s.remove();
                // Próxima aparición de acecho en 1 a 2.5 minutos
                world.setDynamicProperty("elitsano:nextStalkTick", currentTick + 1200 + Math.floor(Math.random() * 1800));
            }
        }
    }
}, 10);
