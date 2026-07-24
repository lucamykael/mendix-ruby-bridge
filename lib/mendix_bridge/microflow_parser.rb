# frozen_string_literal: true

module MendixBridge
  class MicroflowParser
    class << self
      def parse(description)
        mdl = description.fetch("mdl")
        header = mdl.match(
          /\bmicroflow\s+(?<name>[\w.]+)\s*\((?<parameters>.*?)\)\s*(?:returns\s+(?<returns>\S+))?/im
        )
        body = mdl[/\nbegin\s*\n(?<body>.*)\nend;\s*(?:\n|$)/m, :body]

        return { "mdl" => mdl, "parse_status" => "unsupported" } unless header && body

        activities = parse_activities(body)
        {
          "parameters" => parse_parameters(header[:parameters]),
          "return_type" => header[:returns],
          "folder" => mdl[/^folder\s+'([^']*)'/i, 1],
          "variables" => activities.filter_map { |activity| activity["result_variable"] }.uniq,
          "activities" => activities,
          "calls" => mdl.scan(/\bcall\s+microflow\s+([\w.]+)/i).flatten.uniq,
          "execute_roles" => mdl.scan(
            /^grant\s+execute\s+on\s+microflow\s+[\w.]+\s+to\s+([\w.]+)/i
          ).flatten,
          "mdl" => mdl,
          "parse_status" => "parsed"
        }.compact
      end

      private

      def parse_parameters(source)
        source.lines.filter_map do |line|
          match = line.strip.delete_suffix(",").match(/\A\$(\w+):\s*(.+)\z/)
          { "name" => match[1], "type" => match[2] } if match
        end
      end

      def parse_activities(body)
        activities = []
        buffer = +""

        body.each_line do |line|
          stripped = line.strip
          next if stripped.empty? || stripped.start_with?("@")
          next if %w[else].include?(stripped) || stripped.match?(/\Aend\s+if;\z/i)

          buffer << " " unless buffer.empty?
          buffer << stripped

          if buffer.start_with?("if ") && stripped.match?(/\bthen\z/i)
            expression = buffer.sub(/\Aif\s+/i, "").sub(/\s+then\z/i, "")
            activities << activity("decision", buffer, "expression" => expression)
            buffer.clear
          elsif stripped.end_with?(";")
            statement = buffer.delete_suffix(";")
            kind = activity_kind(statement)
            activities << activity(kind, statement, activity_metadata(kind, statement))
            buffer.clear
          end
        end

        activities
      end

      def activity_kind(statement)
        case statement
        when /\A(?:\$\w+\s*=\s*)?call\s+microflow\b/i then "microflow_call"
        when /\Aretrieve\b/i then "retrieve"
        when /\Achange\b/i then "change"
        when /\Adelete\b/i then "delete"
        when /\A(?:\$\w+\s*=\s*)?create\b/i then "create"
        when /\Areturn\b/i then "return"
        when /\Ashow\s+message\b/i then "show_message"
        when /\Aclose\s+page\b/i then "close_page"
        when /\Alog\b/i then "log"
        else "statement"
        end
      end

      def activity_metadata(kind, statement)
        case kind
        when "microflow_call"
          {
            "target" => statement[/\bcall\s+microflow\s+([\w.]+)/i, 1],
            "result_variable" => statement[/\A\$(\w+)\s*=/, 1]
          }.compact
        when "retrieve"
          {
            "result_variable" => statement[/\Aretrieve\s+\$(\w+)/i, 1],
            "source" => statement[/\sfrom\s+(.+)\z/i, 1]
          }.compact
        when "create"
          { "result_variable" => statement[/\A\$(\w+)\s*=/, 1] }.compact
        when "return"
          { "value" => statement.sub(/\Areturn\b\s*/i, "") }
        else
          {}
        end
      end

      def activity(kind, statement, metadata = {})
        { "kind" => kind, "statement" => statement, **metadata }
      end
    end
  end
end
