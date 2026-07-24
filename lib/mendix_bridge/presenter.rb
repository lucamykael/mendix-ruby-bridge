# frozen_string_literal: true

module MendixBridge
  class Presenter
    def self.summary(element)
      details = element.details&.reject { |key, _value| %w[mdl raw].include?(key) }
      {
        "name" => element.qualified_name || element.label,
        "type" => element.type,
        "path" => element.path,
        "details" => details
      }.compact
    end

    def self.search_result(element)
      {
        "name" => element.qualified_name || element.label,
        "type" => element.type,
        "path" => element.path.join(" / ")
      }.compact
    end

    def self.text(element)
      result = summary(element)
      lines = [
        "Name: #{result.fetch('name')}",
        "Type: #{result.fetch('type')}",
        "Path: #{element.path.join(' / ')}"
      ]
      details = result["details"]
      lines << "Details:\n#{JSON.pretty_generate(details)}" if details && !details.empty?
      lines.join("\n")
    end
  end
end
