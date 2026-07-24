# frozen_string_literal: true

module MendixBridge
  class MicroflowParser
    class << self
      def parse(description)
        mdl = description.fetch("mdl")
        header = mdl.match(
          /\b(?:microflow|nanoflow)\s+(?<name>[\w.]+)\s*\((?<parameters>.*?)\)\s*(?:returns\s+(?<returns>\S+))?/im
        )
        body = mdl[/\nbegin\s*\n(?<body>.*)\nend;\s*(?:\n|$)/m, :body]

        return { "mdl" => mdl, "parse_status" => "unsupported" } unless header && body

        activities = parse_activities(body)
        microflow_calls = calls(mdl, "microflow")
        nanoflow_calls = calls(mdl, "nanoflow")
        javascript_action_calls = calls(mdl, "javascript action")
        {
          "parameters" => parse_parameters(header[:parameters]),
          "return_type" => header[:returns],
          "folder" => mdl[/^folder\s+'([^']*)'/i, 1],
          "variables" => activities.filter_map { |activity| activity["result_variable"] }.uniq,
          "activities" => activities,
          "calls" => all_calls(mdl),
          "microflow_calls" => microflow_calls,
          "nanoflow_calls" => nanoflow_calls,
          "javascript_action_calls" => javascript_action_calls,
          "execute_roles" => mdl.scan(
            /^grant\s+execute\s+on\s+microflow\s+[\w.]+\s+to\s+([\w.]+)/i
          ).flatten,
          "mdl" => mdl,
          "parse_status" => "parsed"
        }.compact
      end

      private

      def calls(mdl, kind)
        mdl.scan(/\bcall\s+#{Regexp.escape(kind)}\s+([\w.]+)/i).flatten.uniq
      end

      def all_calls(mdl)
        mdl.scan(
          /\bcall\s+(?:microflow|nanoflow|javascript\s+action)\s+([\w.]+)/i
        ).flatten.uniq
      end

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
        when /\A(?:\$\w+\s*=\s*)?call\s+nanoflow\b/i then "nanoflow_call"
        when /\A(?:\$\w+\s*=\s*)?call\s+javascript\s+action\b/i then "javascript_action_call"
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
        when "microflow_call", "nanoflow_call", "javascript_action_call"
          call_kind = {
            "microflow_call" => "microflow",
            "nanoflow_call" => "nanoflow",
            "javascript_action_call" => "javascript action"
          }.fetch(kind)
          {
            "target" => statement[/\bcall\s+#{Regexp.escape(call_kind)}\s+([\w.]+)/i, 1],
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
