# frozen_string_literal: true

module MendixBridge
  class EnumerationParser
    class << self
      def parse(description)
        mdl = description.fetch("mdl")
        body = mdl[
          /\benumeration\s+[\w.]+\s*\(\s*(?<body>.*?)\s*\)\s*(?:FOLDER\b|;)/im,
          :body
        ]

        return { "mdl" => mdl, "parse_status" => "unsupported" } unless body

        {
          "values" => parse_values(body),
          "folder" => mdl[/\bFOLDER\s+'((?:''|[^'])*)'/i, 1]&.gsub("''", "'"),
          "mdl" => mdl,
          "parse_status" => "parsed"
        }.compact
      end

      private

      def parse_values(body)
        body.scan(/^\s*(\w+)\s+'((?:''|[^'])*)'\s*,?\s*$/).map do |name, caption|
          { "name" => name, "caption" => caption.gsub("''", "'") }
        end
      end
    end
  end
end
