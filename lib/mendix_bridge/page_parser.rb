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
        actions      = mdl.scan(/\bAction:\s*([^,\n\)]+)/i).flatten.map(&:strip)
        data_sources = mdl.scan(/\bDataSource:\s*([^,\n\)]+)/i).flatten.map(&:strip)

        # Build the hierarchical widget tree using the dedicated parser.
        widget_tree  = MdlParser.parse_page_widgets(mdl)
        all_widgets  = MdlParser.flat_widgets(widget_tree)
        widget_names = MdlParser.flat_widget_names(widget_tree)

        # Backward-compatible flat widget list (kept for existing consumers).
        flat_list = all_widgets.map do |node|
          entry = { "type" => node["type"], "name" => node["name"] }
          entry.compact
        end

        {
          "title"           => quoted_setting(settings, "Title"),
          "layout"          => scalar_setting(settings, "Layout"),
          "folder"          => quoted_setting(settings, "Folder"),
          "parameters"      => parse_parameters(settings),
          "widget_tree"     => widget_tree,
          "widgets"         => flat_list,
          "widget_names"    => widget_names,
          "widget_types"    => widget_counts(all_widgets),
          "data_sources"    => data_sources.uniq,
          "actions"         => actions.map { |a| parse_action(a) },
          "microflow_calls" => referenced(actions, "microflow"),
          "nanoflow_calls"  => referenced(actions, "nanoflow"),
          "page_links"      => referenced(actions, "show_page"),
          "attributes"      => mdl.scan(/\bAttribute:\s*([^,\n\)]+)/i).flatten.map(&:strip).uniq,
          "view_roles"      => mdl.scan(
            /^grant\s+view\s+on\s+page\s+[\w.]+\s+to\s+([\w.]+)/i
          ).flatten,
          "mdl"             => mdl,
          "parse_status"    => "parsed"
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

      def widget_counts(all_widgets)
        all_widgets.each_with_object(Hash.new(0)) do |node, counts|
          counts[node["type"]] += 1
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
