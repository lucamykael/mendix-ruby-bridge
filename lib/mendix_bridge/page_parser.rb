# frozen_string_literal: true

module MendixBridge
  class PageParser
    class << self
      def parse(description)
        mdl = description.fetch("mdl")
        header = mdl.match(
          /\bpage\s+(?<name>[\w.]+)\s*\((?<settings>.*?)\)\s*\{/im
        )
        return { "mdl" => mdl, "parse_status" => "unsupported" } unless header

        settings = header[:settings]
        actions = mdl.scan(/\bAction:\s*([^,\n\)]+)/i).flatten.map(&:strip)
        data_sources = mdl.scan(/\bDataSource:\s*([^,\n\)]+)/i).flatten.map(&:strip)

        {
          "title" => quoted_setting(settings, "Title"),
          "layout" => scalar_setting(settings, "Layout"),
          "folder" => quoted_setting(settings, "Folder"),
          "parameters" => parse_parameters(settings),
          "widgets" => parse_widgets(mdl),
          "widget_types" => widget_counts(mdl),
          "data_sources" => data_sources.uniq,
          "actions" => actions.map { |action| parse_action(action) },
          "microflow_calls" => referenced(actions, "microflow"),
          "nanoflow_calls" => referenced(actions, "nanoflow"),
          "page_links" => referenced(actions, "show_page"),
          "attributes" => mdl.scan(/\bAttribute:\s*([^,\n\)]+)/i).flatten.map(&:strip).uniq,
          "view_roles" => mdl.scan(
            /^grant\s+view\s+on\s+page\s+[\w.]+\s+to\s+([\w.]+)/i
          ).flatten,
          "mdl" => mdl,
          "parse_status" => "parsed"
        }.compact
      end

      private

      def quoted_setting(settings, name)
        settings[/\b#{Regexp.escape(name)}:\s*'((?:''|[^'])*)'/i, 1]&.gsub("''", "'")
      end

      def scalar_setting(settings, name)
        settings[/\b#{Regexp.escape(name)}:\s*([^,\n]+)/i, 1]&.strip
      end

      def parse_parameters(settings)
        source = settings[/\bParams:\s*\{(.*?)\}/im, 1]
        return [] unless source

        source.scan(/\$(\w+):\s*([\w.]+)/).map do |name, type|
          { "name" => name, "type" => type }
        end
      end

      def parse_widgets(mdl)
        mdl.lines.filter_map do |line|
          stripped = line.strip
          next if stripped.start_with?("--")

          match = stripped.match(
            /\A(?<type>[a-z][a-z0-9_]*)\s*(?<name>"[^"]+"|[A-Za-z_]\w*)?\s*(?<opening>\(|\{)/
          )
          next unless match
          next if %w[create grant].include?(match[:type])

          {
            "type" => match[:type],
            "name" => match[:name]&.delete_prefix('"')&.delete_suffix('"'),
            "declaration" => stripped
          }.compact
        end
      end

      def widget_counts(mdl)
        parse_widgets(mdl).each_with_object(Hash.new(0)) do |widget, counts|
          counts[widget["type"]] += 1
        end.sort.to_h
      end

      def parse_action(action)
        kind, target = action.split(/\s+/, 2)
        { "kind" => kind, "target" => target }.compact
      end

      def referenced(actions, kind)
        actions.filter_map do |action|
          match = action.match(/\A#{Regexp.escape(kind)}\s+([\w.]+)/i)
          match[1] if match
        end.uniq
      end
    end
  end
end
