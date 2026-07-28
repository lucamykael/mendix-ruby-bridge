# frozen_string_literal: true

require "strscan"

module MendixBridge
  # Parses the widget tree out of a Mendix page MDL string.
  #
  # Each widget node is a Hash:
  #   {
  #     "type"       => "dataview",          # MDL keyword (lowercase)
  #     "name"       => "dv1",               # widget identifier (nil if anonymous)
  #     "properties" => { "DataSource" => "$Customer", "Class" => "..." },
  #     "children"   => [ ...widget nodes... ]
  #   }
  #
  # Usage:
  #   tree  = MdlParser.parse_page_widgets(full_mdl_string)
  #   names = MdlParser.flat_widget_names(tree)
  module MdlParser
    # Words that open MDL statements and are never widget type keywords.
    STATEMENT_KEYWORDS = %w[
      create or modify alter grant revoke drop select
    ].to_set.freeze

    # Value qualifiers: first word of a multi-word property value.
    MULTI_WORD_QUALIFIERS = %w[
      microflow nanoflow database association xpath show_page open_page
    ].to_set.freeze

    # Parse the full MDL of a page (including its CREATE / MODIFY header) and
    # return the top-level widget tree extracted from the page body { }.
    def self.parse_page_widgets(full_mdl)
      sc = StringScanner.new(full_mdl.to_s)
      # Advance past 'page Module.Name ('
      unless sc.skip_until(/\bpage\s+[\w.]+\s*\(/i)
        return []
      end
      # Consume balanced settings (...) — opening ( already consumed by skip_until
      collect_balanced(sc, "(", ")")
      sc.skip(/\s*/)
      return [] unless sc.scan(/\{/)
      body = collect_balanced(sc, "{", "}")
      parse_widget_tree(body)
    end

    # Parse a raw MDL body (content between outer braces) into a widget tree.
    def self.parse_widget_tree(source)
      sc = StringScanner.new(source.to_s)
      nodes = []
      until sc.eos?
        skip_ws_and_comments(sc)
        break if sc.eos?
        node = parse_widget_node(sc)
        if node
          nodes << node
        else
          sc.getch # skip unknown char and keep going
        end
      end
      nodes
    end

    # Return a flat array of all named widget identifiers in the tree (DFS).
    def self.flat_widget_names(tree)
      tree.flat_map do |node|
        named = node["name"] ? [node["name"]] : []
        named + flat_widget_names(node["children"] || [])
      end
    end

    # Return a flat array of all widget nodes (named and anonymous), DFS.
    def self.flat_widgets(tree)
      tree.flat_map do |node|
        [node] + flat_widgets(node["children"] || [])
      end
    end

    # -------------------------------------------------------------------------
    private_class_method def self.skip_ws_and_comments(sc)
      loop do
        sc.skip(/\s+/)
        sc.scan(/--[^\n]*/) ? next : break
      end
    end

    private_class_method def self.parse_widget_node(sc)
      start = sc.pos

      # Widget type must be a lowercase word
      type = sc.scan(/[a-z][a-z0-9_]*/)
      return nil unless type
      if STATEMENT_KEYWORDS.include?(type)
        sc.pos = start
        return nil
      end

      skip_ws_and_comments(sc)

      # Optional widget name: quoted or plain identifier (not a paren or brace)
      name = sc.scan(/"[^"]*"/) || sc.scan(/[A-Za-z_]\w*/)
      if name
        # Roll back if we consumed a keyword that isn't a name
        if STATEMENT_KEYWORDS.include?(name.downcase)
          sc.pos -= name.bytesize
          name = nil
        else
          name = name.delete_prefix('"').delete_suffix('"')
        end
      end

      skip_ws_and_comments(sc)

      # Must be followed by '(' to be a widget declaration
      unless sc.scan(/\(/)
        sc.pos = start
        return nil
      end

      props_raw  = collect_balanced(sc, "(", ")")
      properties = parse_properties(props_raw)

      skip_ws_and_comments(sc)

      children = []
      if sc.scan(/\{/)
        body = collect_balanced(sc, "{", "}")
        children = parse_widget_tree(body)
      end

      { "type" => type, "name" => name, "properties" => properties, "children" => children }.compact
    end

    # Collect everything between a matched pair of delimiters.  The opening
    # delimiter has already been consumed; depth starts at 1.
    private_class_method def self.collect_balanced(sc, open, close)
      depth = 1
      buf = +""
      until sc.eos? || depth.zero?
        ch = sc.getch
        case ch
        when open  then depth += 1; buf << ch
        when close
          depth -= 1
          buf << ch unless depth.zero?
        when "'"
          # Single-quoted string: '' is an escaped quote inside the string.
          buf << ch
          loop do
            c = sc.getch
            break if c.nil?
            buf << c
            next unless c == "'"
            if sc.peek(1) == "'"
              buf << sc.getch # consume the escaped-quote twin
            else
              break
            end
          end
        else
          buf << ch
        end
      end
      buf
    end

    private_class_method def self.parse_properties(raw)
      sc  = StringScanner.new(raw.strip)
      out = {}
      until sc.eos?
        skip_ws_and_comments(sc)
        sc.skip(/,/)
        skip_ws_and_comments(sc)
        break if sc.eos?

        key = sc.scan(/[A-Za-z_]\w*/)
        break unless key

        skip_ws_and_comments(sc)
        next unless sc.scan(/:/)
        skip_ws_and_comments(sc)

        value = parse_value(sc)
        out[key] = value unless value.nil?
      end
      out
    end

    private_class_method def self.parse_value(sc)
      sc.skip(/\s*/)
      return nil if sc.eos?

      # Single-quoted string
      if sc.scan(/'/)
        str = +""
        loop do
          c = sc.getch
          break if c.nil?
          if c == "'" && sc.peek(1) == "'"
            str << "'"
            sc.getch  # consume the escape twin, discard it
          elsif c == "'"
            break
          else
            str << c
          end
        end
        return str
      end

      # Expression in square brackets [...]
      if sc.scan(/\[/)
        return "[#{collect_balanced(sc, "[", "]")}]"
      end

      # Nested block {...}
      if sc.scan(/\{/)
        return "{#{collect_balanced(sc, "{", "}")}}"
      end

      # Number (integer or float, optionally negative)
      if (num = sc.scan(/-?\d+(?:\.\d+)?/))
        return num.include?(".") ? num.to_f : num.to_i
      end

      # Identifier-based value (includes $variables and dotted paths like Module.Attr)
      if (first = sc.scan(/\$?[A-Za-z_]\w*(?:[.$\/]\w+)*/))
        skip_ws_and_comments(sc)

        # Function call: ident(args)  →  "ident(args)"
        if sc.scan(/\(/)
          args = collect_balanced(sc, "(", ")")
          return "#{first}(#{args})"
        end

        # Multi-word qualifiers: microflow Module.Name, database Module.Entity, etc.
        if MULTI_WORD_QUALIFIERS.include?(first)
          saved = sc.pos
          sc.skip(/\s+/)
          second = sc.scan(/\$?[A-Za-z_]\w*(?:[.$\/]\w+)*/)
          if second
            skip_ws_and_comments(sc)
            if sc.scan(/\(/)
              args = collect_balanced(sc, "(", ")")
              return "#{first} #{second}(#{args})"
            end
            if first == "xpath" && sc.scan(/\[/)
              constraint = "[#{collect_balanced(sc, "[", "]")}]"
              return "#{first} #{second}#{constraint}"
            end
            return "#{first} #{second}"
          else
            sc.pos = saved
          end
        end

        return true  if first == "true"
        return false if first == "false"
        return first
      end

      nil
    end
  end
end
