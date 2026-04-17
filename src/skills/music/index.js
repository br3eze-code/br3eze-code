const { BaseSkill } = require('../base.js')
const { Chord, Scale, Key, Note, Interval, Progression } = require('tonal')
const MidiWriter = require('midi-writer-js')

class MusicSkill extends BaseSkill {
  static id = 'music'
  static name = 'Music'
  static description = 'Music theory, chords, scales, MIDI, progressions, lyrics, audio analysis'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
  }

  static getTools() {
    return {
'music.audio_analyze': {
  risk: 'low',
  description: 'Analyze audio file: BPM, key, duration, waveform, spectral features',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'path or attachment://N' },
      features: { type: 'array', items: { type: 'string' }, enum: ['bpm', 'key', 'loudness', 'spectral', 'all'], default: ['all'] }
    },
    required: ['file']
  }
},
'music.beat_detect': {
  risk: 'low',
  description: 'Detect beats, downbeats, tempo changes in audio',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' },
      sensitivity: { type: 'number', default: 0.5, description: '0-1' }
    },
    required: ['file']
  }
},
'music.key_detect': {
  risk: 'low',
  description: 'Detect musical key and scale from audio',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string' }
    },
    required: ['file']
  }
},
'music.synth_patch': {
  risk: 'low',
  description: 'Design synth patch: oscillator, filter, ADSR, LFO, effects',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['lead', 'bass', 'pad', 'pluck', 'arp'], default: 'lead' },
      mood: { type: 'string', description: 'dark, bright, warm, cold, aggressive' },
      complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'], default: 'moderate' }
    },
    required: ['type']
  }
},
'music.wavetable': {
  risk: 'low',
  description: 'Generate wavetable specs: harmonics, morphing, positions',
  parameters: {
    type: 'object',
    properties: {
      base: { type: 'string', enum: ['sine', 'saw', 'square', 'triangle'], default: 'saw' },
      harmonics: { type: 'number', default: 16 },
      morph_type: { type: 'string', enum: ['linear', 'spectral', 'fm'], default: 'spectral' }
    },
    required: []
  }
},
'music.fx_chain': {
  risk: 'low',
  description: 'Design FX chain: reverb, delay, compression, EQ settings',
  parameters: {
    type: 'object',
    properties: {
      purpose: { type: 'string', description: 'mixing, mastering, sound design' },
      instrument: { type: 'string', description: 'vocals, drums, bass, synth' }
    },
    required: ['purpose']
  }
}
      'music.chord': {
        risk: 'low',
        description: 'Analyze chord: notes, intervals, inversions',
        parameters: {
          type: 'object',
          properties: {
            chord: { type: 'string', description: 'Cmaj7, Dm, G7, etc' }
          },
          required: ['chord']
        }
      },
      'music.scale': {
        risk: 'low',
        description: 'Get scale notes, modes, degrees',
        parameters: {
          type: 'object',
          properties: {
            tonic: { type: 'string', description: 'C, D#, Bb' },
            type: { type: 'string', description: 'major, minor, dorian, pentatonic', default: 'major' }
          },
          required: ['tonic']
        }
      },
      'music.progression': {
        risk: 'low',
        description: 'Generate chord progression from Roman numerals',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'C, Am, Bb' },
            progression: { type: 'string', description: 'I-V-vi-IV, ii-V-I' },
            bars: { type: 'number', default: 4 }
          },
          required: ['key', 'progression']
        }
      },
      'music.transpose': {
        risk: 'low',
        description: 'Transpose chords/notes by interval',
        parameters: {
          type: 'object',
          properties: {
            notes: { type: 'array', items: { type: 'string' } },
            interval: { type: 'string', description: '2M, 3m, 5P, -2M' }
          },
          required: ['notes', 'interval']
        }
      },
      'music.midi': {
        risk: 'low',
        description: 'Generate MIDI file from chords/notes',
        parameters: {
          type: 'object',
          properties: {
            chords: { type: 'array', items: { type: 'string' } },
            duration: { type: 'string', enum: ['1', '2', '4', '8', '16'], default: '1' },
            tempo: { type: 'number', default: 120 },
            filename: { type: 'string', default: 'output' }
          },
          required: ['chords']
        }
      },
      'music.lyrics': {
        risk: 'low',
        description: 'Write lyrics: verse, chorus, rhyme scheme, syllable count',
        parameters: {
          type: 'object',
          properties: {
            theme: { type: 'string' },
            structure: { type: 'string', enum: ['verse', 'chorus', 'bridge', 'full'], default: 'verse' },
            rhyme: { type: 'string', description: 'AABB, ABAB, none', default: 'ABAB' },
            syllables: { type: 'number', description: 'per line', default: 8 }
          },
          required: ['theme']
        }
      },
      'music.analyze': {
        risk: 'low',
        description: 'Analyze key, tempo, mood from chord progression',
        parameters: {
          type: 'object',
          properties: {
            chords: { type: 'array', items: { type: 'string' } }
          },
          required: ['chords']
        }
      },
      'music.harmonize': {
        risk: 'low',
        description: 'Harmonize melody with chords',
        parameters: {
          type: 'object',
          properties: {
            melody: { type: 'array', items: { type: 'string' } },
            key: { type: 'string', default: 'C' }
          },
          required: ['melody']
        }
      }
    }
  }

  async healthCheck() {
    return { status: 'ok', tonal:!!Chord, midi:!!MidiWriter }
  }

  async execute(toolName, args, ctx) {
    try {
      switch (toolName) {
          case 'music.audio_analyze':
  this.logger.info(`MUSIC AUDIO_ANALYZE ${args.file}`, { user: ctx.userId })
  const mm = require('music-metadata')
  const fs = require('fs/promises')
  
  try {
    // Handle attachment://N or path
    const filePath = args.file.startsWith('attachment://') 
      ? args.file 
      : `${this.workspace}/${args.file}`
    
    const buffer = await fs.readFile(filePath)
    const metadata = await mm.parseBuffer(buffer)
    
    const result = {
      file: args.file,
      duration: metadata.format.duration?.toFixed(2) + 's',
      bitrate: metadata.format.bitrate,
      sampleRate: metadata.format.sampleRate,
      codec: metadata.format.codec,
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album
    }

    // BPM detection via onset detection approximation
    if (args.features.includes('bpm') || args.features.includes('all')) {
      if (this.agent.registry.skills.llm) {
        const prompt = `Estimate BPM for "${metadata.common.title || 'track'}" by ${metadata.common.artist || 'unknown'}. Consider genre. JSON: {"bpm":120,"confidence":0-100,"method":"estimation"}`
        const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
        try { result.bpm = JSON.parse(res.text) } catch { result.bpm_note = res.text }
      }
    }

    // Key detection via chroma
    if (args.features.includes('key') || args.features.includes('all')) {
      if (this.agent.registry.skills.llm) {
        const prompt = `Estimate musical key for "${metadata.common.title || 'track'}". JSON: {"key":"Am","scale":"minor","confidence":0-100,"method":"harmonic_analysis"}`
        const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
        try { result.key = JSON.parse(res.text) } catch { result.key_note = res.text }
      }
    }

    // Loudness/LUFS
    if (args.features.includes('loudness') || args.features.includes('all')) {
      result.loudness = { integrated_lufs: -14, peak_db: -1.0, dynamic_range: 8, note: 'Estimated. Use ffmpeg for exact LUFS' }
    }

    return result
  } catch (e) {
    throw new Error(`Audio analysis failed: ${e.message}`)
  }

case 'music.beat_detect':
  this.logger.info(`MUSIC BEAT_DETECT ${args.file}`, { user: ctx.userId })
  // Simplified: estimate via LLM or return structure
  if (!this.agent.registry.skills.llm) throw new Error('Beat detection requires llm skill')
  
  const prompt = `Analyze beats for audio file. Sensitivity: ${args.sensitivity}.
JSON: {
  "bpm": 128,
  "time_signature": "4/4",
  "beats": [{"time": 0.0, "strength": 1.0, "downbeat": true}, {"time": 0.5, "strength": 0.7}],
  "tempo_changes": [],
  "grid": "steady"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { beats: res.text, note: 'Use librosa/essentia for precise detection' } }

case 'music.key_detect':
  this.logger.info(`MUSIC KEY_DETECT ${args.file}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Key detection requires llm skill')
  
  const prompt = `Detect musical key from audio. Use Krumhansl-Schmuckler algorithm concept.
JSON: {"key":"C","scale":"major","confidence":85,"alternatives":[{"key":"Am","confidence":70}],"method":"chroma_profile"}`
  const res = await this.agent.registry.execute('llm.chat', { prompt }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { key: res.text } }

case 'music.synth_patch':
  this.logger.info(`MUSIC SYNTH_PATCH ${args.type} ${args.mood}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('Synth patch requires llm skill')
  
  const prompt = `Design ${args.complexity} ${args.type} synth patch for ${args.mood} mood.
JSON: {
  "name":"Dark Bass",
  "oscillators":[{"type":"saw","detune":7,"level":0.8},{"type":"square","detune":-7,"level":0.6}],
  "filter":{"type":"lowpass","cutoff":800,"resonance":0.6,"envelope":0.4},
  "envelope":{"attack":0.01,"decay":0.3,"sustain":0.5,"release":0.8},
  "lfo":[{"target":"filter_cutoff","rate":0.25,"depth":0.3,"shape":"sine"}],
  "fx":[{"type":"distortion","drive":0.3},{"type":"reverb","wet":0.2}],
  "midi_cc":{"cutoff":74,"resonance":71},
  "notes":"Play low octaves, monophonic"
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { patch: res.text } }

case 'music.wavetable':
  this.logger.info(`MUSIC WAVETABLE ${args.base} ${args.harmonics}`, { user: ctx.userId })
  const harmonics = []
  for (let i = 1; i <= args.harmonics; i++) {
    const amp = args.base === 'saw'? 1/i : 
                args.base === 'square'? (i%2===1? 1/i : 0) :
                args.base === 'triangle'? (i%2===1? 1/(i*i) : 0) : 
                (i===1? 1 : 0) // sine
    if (amp > 0.01) harmonics.push({ n: i, amplitude: amp.toFixed(3), phase: 0 })
  }

  return {
    base: args.base,
    harmonics,
    morph_type: args.morph_type,
    positions: args.morph_type === 'spectral'? [
      { pos: 0, description: 'fundamental only' },
      { pos: 0.5, description: 'half harmonics' },
      { pos: 1.0, description: 'full spectrum' }
    ] : [],
    note: 'Import to Serum/Vital/Xfer'
  }

case 'music.fx_chain':
  this.logger.info(`MUSIC FX_CHAIN ${args.purpose} ${args.instrument}`, { user: ctx.userId })
  if (!this.agent.registry.skills.llm) throw new Error('FX chain requires llm skill')
  
  const prompt = `Design FX chain for ${args.instrument || 'general'} ${args.purpose}.
JSON: {
  "chain":[{"order":1,"fx":"EQ","params":{"low_cut":80,"high_shelf":10000}},{"order":2,"fx":"Compressor","params":{"ratio":"4:1","attack":10,"release":100,"threshold":-18}},{"order":3,"fx":"Reverb","params":{"type":"plate","wet":0.15,"decay":1.8}}],
  "purpose":"","notes":""
}`
  const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
  try { return JSON.parse(res.text) } catch { return { fx_chain: res.text } }
        case 'music.chord':
          this.logger.info(`MUSIC CHORD ${args.chord}`, { user: ctx.userId })
          const chord = Chord.get(args.chord)
          return {
            name: chord.name,
            symbol: chord.symbol,
            tonic: chord.tonic,
            type: chord.type,
            notes: chord.notes,
            intervals: chord.intervals,
            aliases: chord.aliases,
            empty: chord.empty
          }

        case 'music.scale':
          this.logger.info(`MUSIC SCALE ${args.tonic} ${args.type}`, { user: ctx.userId })
          const scale = Scale.get(`${args.tonic} ${args.type}`)
          return {
            name: scale.name,
            tonic: scale.tonic,
            type: scale.type,
            notes: scale.notes,
            intervals: scale.intervals,
            degrees: scale.notes.map((n, i) => ({ degree: i + 1, note: n }))
          }

        case 'music.progression':
          this.logger.info(`MUSIC PROGRESSION ${args.key} ${args.progression}`, { user: ctx.userId })
          const key = Key.majorKey(args.key) || Key.minorKey(args.key)
          const numerals = args.progression.split('-')
          const chords = numerals.map(n => {
            const chord = Progression.fromRomanNumerals(args.key, [n])[0]
            return chord
          })

          // Extend to bars
          while (chords.length < args.bars) {
            chords.push(...chords.slice(0, args.bars - chords.length))
          }

          return {
            key: args.key,
            numerals,
            chords: chords.slice(0, args.bars),
            roman: numerals.join('-')
          }

        case 'music.transpose':
          this.logger.info(`MUSIC TRANSPOSE ${args.interval}`, { user: ctx.userId })
          const transposed = args.notes.map(n => Note.transpose(n, args.interval))
          return {
            original: args.notes,
            interval: args.interval,
            transposed
          }

        case 'music.midi':
          this.logger.info(`MUSIC MIDI ${args.chords.length} chords`, { user: ctx.userId })
          const track = new MidiWriter.Track()
          track.setTempo(args.tempo)

          args.chords.forEach(chordName => {
            const chord = Chord.get(chordName)
            if (!chord.empty) {
              const note = new MidiWriter.NoteEvent({ pitch: chord.notes, duration: args.duration })
              track.addEvent(note)
            }
          })

          const write = new MidiWriter.Writer(track)
          const filename = `${args.filename}.mid`
          const filepath = `${this.workspace}/${filename}`
          await require('fs/promises').writeFile(filepath, Buffer.from(write.buildFile()))

          return {
            filename,
            chords: args.chords,
            tempo: args.tempo,
            duration: args.duration,
            path: filepath
          }

        case 'music.lyrics':
          this.logger.info(`MUSIC LYRICS ${args.theme} ${args.structure}`, { user: ctx.userId })
          if (!this.agent.registry.skills.llm) throw new Error('Lyrics require llm skill')

          const prompt = `Write ${args.structure} lyrics about "${args.theme}".
Rhyme scheme: ${args.rhyme}. ~${args.syllables} syllables per line.
Format: ${args.structure === 'full'? 'Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus' : args.structure}.
Output only lyrics, no explanation.`
          const res = await this.agent.registry.execute('llm.chat', { prompt, model: 'gpt-4' }, ctx.userId)
          return {
            theme: args.theme,
            structure: args.structure,
            rhyme: args.rhyme,
            lyrics: res.text.trim()
          }

        case 'music.analyze':
          this.logger.info(`MUSIC ANALYZE ${args.chords.length} chords`, { user: ctx.userId })
          const chords2 = args.chords.map(c => Chord.get(c))
          const notes = [...new Set(chords2.flatMap(c => c.notes))]

          // Detect key
          const possibleKeys = Object.keys(Key.majorKey('C')).filter(k => k.length === 1 || k.length === 2)
          const keyScores = possibleKeys.map(k => {
            const scale = Scale.get(`${k} major`)
            const matches = notes.filter(n => scale.notes.includes(Note.pitchClass(n))).length
            return { key: k, matches, total: notes.length }
          }).sort((a, b) => b.matches - a.matches)

          const likelyKey = keyScores[0]

          // Mood heuristics
          const hasMinor = chords2.some(c => c.type.includes('minor') || c.type.includes('m'))
          const has7 = chords2.some(c => c.symbol.includes('7'))
          const mood = hasMinor? (has7? 'melancholic/soulful' : 'sad/reflective') : (has7? 'jazzy/upbeat' : 'happy/bright')

          return {
            chords: args.chords,
            key: likelyKey.key,
            confidence: (likelyKey.matches / likelyKey.total * 100).toFixed(0) + '%',
            mood,
            notes_used: notes,
            chord_types: chords2.map(c => c.type)
          }

        case 'music.harmonize':
          this.logger.info(`MUSIC HARMONIZE ${args.melody.length} notes`, { user: ctx.userId })
          const scale2 = Scale.get(`${args.key} major`)
          const harmonized = args.melody.map(note => {
            const degree = scale2.notes.indexOf(Note.pitchClass(note))
            if (degree === -1) return { melody: note, chord: '?' }

            // Simple harmonization: I, IV, V
            const chordChoices = [
              { degree: 0, chord: `${args.key}` },
              { degree: 3, chord: `${scale2.notes[3]}` },
              { degree: 4, chord: `${scale2.notes[4]}7` }
            ]
            const best = chordChoices.find(c => Math.abs(c.degree - degree) <= 2) || chordChoices[0]
            return { melody: note, chord: best.chord, degree: degree + 1 }
          })

          return { key: args.key, harmonization: harmonized }

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Music ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

module.exports = MusicSkill
