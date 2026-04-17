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
